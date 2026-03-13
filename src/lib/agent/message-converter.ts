/**
 * Converts persisted DB messages to the ChatMessage format used by LLM providers.
 * Extracted from loop.ts for maintainability.
 */

import type { ChatMessage, ToolCall, ContentPart } from "@/lib/llm";
import { addLog, type Message } from "@/lib/db";
import { isUntrustedToolOutput } from "./system-prompt";

export function dbMessagesToChat(
  messages: Message[],
  latestContentParts?: ContentPart[]
): ChatMessage[] {
  // Single-pass: collect assistant messages first, then assemble result.
  // Pre-parse tool_calls once to avoid redundant JSON.parse per message.
  const knownToolCallIds = new Set<string>();
  const parsedToolCalls = new Map<number, ToolCall[]>(); // message index → parsed tool_calls

  // Collect known tool_call_ids and cache parsed tool_calls (single parse)
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "assistant" && m.tool_calls) {
      try {
        const tcs: ToolCall[] = JSON.parse(m.tool_calls);
        parsedToolCalls.set(i, tcs);
        for (const tc of tcs) {
          knownToolCallIds.add(tc.id);
        }
      } catch (err) {
        addLog({
          level: "verbose",
          source: "agent",
          message: "Skipped malformed assistant tool_calls in history reconstruction.",
          metadata: JSON.stringify({ threadId: m.thread_id, error: err instanceof Error ? err.message : String(err) }),
        });
      }
    }
  }

  const result: ChatMessage[] = [];
  for (let idx = 0; idx < messages.length; idx++) {
    const m = messages[idx];
    const isLast = idx === messages.length - 1;

    // Skip system messages — system prompt is injected separately
    if (m.role === "system") continue;

    // Use pre-parsed tool_calls from cache (avoid redundant JSON.parse)
    const toolCalls: ToolCall[] | undefined = parsedToolCalls.get(idx);

    // Parse tool_call_id for tool messages
    if (m.role === "tool") {
      let toolCallId: string | undefined;
      let toolName: string | undefined;
      if (m.tool_results) {
        try {
          const tr = JSON.parse(m.tool_results);
          toolCallId = tr.tool_call_id;
          toolName = tr.name;
        } catch (err) {
          addLog({
            level: "verbose",
            source: "agent",
            message: "Skipped malformed tool_results payload.",
            metadata: JSON.stringify({ threadId: m.thread_id, error: err instanceof Error ? err.message : String(err) }),
          });
        }
      }
      // Skip tool messages that don't have a valid tool_call_id
      // or whose tool_call_id doesn't match a known assistant tool call
      if (!toolCallId || !knownToolCallIds.has(toolCallId)) continue;

      // Sanitize any historical screenshot tool results that still contain file paths
      let toolContent = m.content || "";
      if (toolContent.includes('"screenshotPath"') || toolContent.includes('"relativePath"')) {
        toolContent = JSON.stringify({
          status: "screenshot_taken",
          note: "The screenshot image is already displayed to the user in the chat. Do NOT output any file path, URL, or markdown image.",
        });
      }

      // Re-wrap untrusted external content from historical tool results
      if (toolName && isUntrustedToolOutput(toolName) && !toolContent.includes("<untrusted_external_content")) {
        toolContent = `<untrusted_external_content source="${toolName}">\n${toolContent}\n</untrusted_external_content>`;
      }

      result.push({
        role: "tool",
        content: toolContent,
        tool_call_id: toolCallId,
      });
      continue;
    }

    const msg: ChatMessage = {
      role: m.role,
      content: m.content || "",
      tool_calls: toolCalls,
    };
    // Attach multimodal parts to the latest user message
    if (isLast && m.role === "user" && latestContentParts && latestContentParts.length > 0) {
      msg.contentParts = latestContentParts;
    }
    result.push(msg);
  }

  // Sanitize orphaned tool_calls: if an assistant message has tool_calls but
  // one or more corresponding tool result messages are missing (e.g. from an
  // interrupted agent loop), strip the tool_calls to prevent LLM 400 errors.
  const presentToolResultIds = new Set<string>();
  for (const m of result) {
    if (m.role === "tool" && m.tool_call_id) {
      presentToolResultIds.add(m.tool_call_id);
    }
  }

  for (let i = result.length - 1; i >= 0; i--) {
    const m = result[i];
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      const allPresent = m.tool_calls.every((tc) => presentToolResultIds.has(tc.id));
      if (!allPresent) {
        // Remove the orphaned assistant tool_calls message and any tool results
        // that were part of this batch so the LLM doesn't see a partial sequence.
        const orphanedIds = new Set(m.tool_calls.map((tc) => tc.id));
        result.splice(i, 1);
        for (let j = result.length - 1; j >= i; j--) {
          if (result[j].role === "tool" && result[j].tool_call_id && orphanedIds.has(result[j].tool_call_id!)) {
            result.splice(j, 1);
          }
        }
      }
    }
  }

  return result;
}
