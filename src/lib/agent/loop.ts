/**
 * Nexus Agent Core Loop
 *
 * Implements the Sense-Think-Act loop:
 * 1. Receives user message
 * 2. Builds context (knowledge, thread history)
 * 3. Calls LLM with available MCP tools
 * 4. Processes tool calls through HITL gatekeeper
 * 5. Iterates until LLM produces a final response
 *
 * Responsibilities are delegated to focused modules:
 * - tool-setup.ts: tool list assembly & scope filtering
 * - scheduler-task-persistence.ts: scheduled task extraction from chat
 * - inline-approval-flow.ts: approval/reject orchestration
 * - tool-result-processor.ts: screenshot/attachment processing & DB persistence
 * - context-builder.ts: knowledge vault & user profile context
 * - message-converter.ts: DB message → LLM chat format
 * - tool-executor.ts: policy gatekeeper & tool dispatch
 * - title-generator.ts: auto-generate thread titles
 * - knowledge-persistence.ts: knowledge vault ingestion
 * - system-prompt.ts: system prompt constants
 */

import {
  selectProvider,
  selectFallbackProvider,
  type ChatMessage,
  type ChatResponse,
  type ContentPart,
} from "@/lib/llm";
import {
  addMessage,
  getThreadMessages,
  getThread,
  addLog,
  addAttachment,
  type Message,
  type AttachmentMeta,
} from "@/lib/db";
import crypto from "crypto";
import { SYSTEM_PROMPT, MAX_TOOL_ITERATIONS, isUntrustedToolOutput } from "./system-prompt";
import { buildKnowledgeContext, buildProfileContext } from "./context-builder";
import { dbMessagesToChat } from "./message-converter";
import { executeToolWithPolicy } from "./tool-executor";
import { maybeUpdateThreadTitle } from "./title-generator";
import { persistKnowledgeFromTurn } from "./knowledge-persistence";
import { buildFilteredToolList } from "./tool-setup";
import { persistScheduledTasksFromMessage } from "./scheduler-task-persistence";
import { processInlineApproval } from "./inline-approval-flow";
import { processExecutedToolResult, processFailedToolResult } from "./tool-result-processor";

const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

export interface AgentLoopDependencies {
  selectProvider: typeof selectProvider;
  selectFallbackProvider: typeof selectFallbackProvider;
  buildFilteredToolList: typeof buildFilteredToolList;
  addMessage: typeof addMessage;
  getThreadMessages: typeof getThreadMessages;
  addAttachment: typeof addAttachment;
  addLog: typeof addLog;
  executeToolWithPolicy: typeof executeToolWithPolicy;
  persistScheduledTasksFromMessage: typeof persistScheduledTasksFromMessage;
  processInlineApproval: typeof processInlineApproval;
  maybeUpdateThreadTitle: typeof maybeUpdateThreadTitle;
  persistKnowledgeFromTurn: typeof persistKnowledgeFromTurn;
  processExecutedToolResult: typeof processExecutedToolResult;
  processFailedToolResult: typeof processFailedToolResult;
}

const defaultAgentLoopDependencies: AgentLoopDependencies = {
  selectProvider,
  selectFallbackProvider,
  buildFilteredToolList,
  addMessage,
  getThreadMessages,
  addAttachment,
  addLog,
  executeToolWithPolicy,
  persistScheduledTasksFromMessage,
  processInlineApproval,
  maybeUpdateThreadTitle,
  persistKnowledgeFromTurn,
  processExecutedToolResult,
  processFailedToolResult,
};


export interface AgentResponse {
  content: string;
  toolsUsed: string[];
  pendingApprovals: string[];
  attachments: AttachmentMeta[];
}


/**
 * Run the agent loop for a given thread and user message.
 * When `continuation` is true, skips saving a new user message and resumes
 * from the existing DB state (used after tool-approval execution).
 * `userId` scopes knowledge retrieval/ingestion to the specific user.
 */
export async function runAgentLoop(
  threadId: string,
  userMessage: string,
  contentParts?: ContentPart[],
  attachments?: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
  }>,
  continuation?: boolean,
  userId?: string,
  onMessage?: (msg: Message) => void,
  onStatus?: (status: { step: string; detail?: string }) => void,
  onToken?: (token: string) => void | Promise<void>,
  deps: AgentLoopDependencies = defaultAgentLoopDependencies
): Promise<AgentResponse> {
  // Use the orchestrator to pick the best model for this task
  onStatus?.({ step: "Selecting model", detail: "Classifying task complexity…" });
  const hasImages = contentParts?.some((p) => p.type === "image_url") ?? false;
  let orchestration = deps.selectProvider(userMessage || "continuation", hasImages);
  let provider = orchestration.provider;
  onStatus?.({ step: "Selecting model", detail: `Task: ${orchestration.taskType} → ${orchestration.providerLabel}` });

  const tools = await deps.buildFilteredToolList(userId);

  if (!continuation) {
    // Build attachment metadata JSON
    const attachmentsMeta: AttachmentMeta[] | null =
      attachments && attachments.length > 0
        ? attachments.map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            storagePath: a.storagePath,
          }))
        : null;

    // Save the user message (with attachment metadata)
    const savedMsg = deps.addMessage({
      thread_id: threadId,
      role: "user",
      content: userMessage,
      tool_calls: null,
      tool_results: null,
      attachments: attachmentsMeta ? JSON.stringify(attachmentsMeta) : null,
    });
    onMessage?.(savedMsg);

    // Persist attachment records in the attachments table
    if (attachmentsMeta) {
      for (const att of attachmentsMeta) {
        deps.addAttachment({
          id: att.id,
          thread_id: threadId,
          message_id: savedMsg.id,
          filename: att.filename,
          mime_type: att.mimeType,
          size_bytes: att.sizeBytes,
          storage_path: att.storagePath,
        });
      }
    }

    // Persist user-requested future/recurring tasks into scheduler queue.
    deps.persistScheduledTasksFromMessage(threadId, userMessage, userId);

    // Inline approval flow for interactive threads
    const approvalResult = await deps.processInlineApproval(threadId, userMessage, onMessage, onStatus);
    if (approvalResult.handled) {
      if ("resumeContinuation" in approvalResult) {
        return runAgentLoop(threadId, "", undefined, undefined, true, userId, onMessage, onStatus, onToken, deps);
      }
      if ("response" in approvalResult) {
        return approvalResult.response;
      }
    }
  }

  // In continuation mode, extract the last user message from DB for knowledge retrieval
  const queryText = continuation
    ? (() => {
        const msgs = deps.getThreadMessages(threadId);
        const lastUser = [...msgs].reverse().find((m) => m.role === "user");
        return lastUser?.content || "";
      })()
    : userMessage;

  const knowledgeSnippets: string[] = [`[User]\n${queryText}`];

  // Build context from knowledge vault and user profile (extracted to context-builder.ts)
  const knowledgeContext = await buildKnowledgeContext(queryText, userId, onStatus);
  onStatus?.({ step: "Building context", detail: "Loading user profile and chat history" });
  const profileContext = buildProfileContext(userId);
  const dbMessages = deps.getThreadMessages(threadId);
  const chatMessages = dbMessagesToChat(dbMessages, continuation ? undefined : contentParts);

  const toolsUsed: string[] = [];
  const pendingApprovals: string[] = [];
  const screenshotAttachments: AttachmentMeta[] = [];
  let iterations = 0;

  deps.addLog({
    level: "thought",
    source: "agent",
    message: continuation
      ? `Continuing agent loop in thread ${threadId} after approval`
      : `Processing user message in thread ${threadId}`,
    metadata: JSON.stringify({
      messagePreview: queryText.substring(0, 100),
      orchestration: orchestration.reason,
      provider: orchestration.providerLabel,
      taskType: orchestration.taskType,
    }),
  });

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    await yieldLoop(); // yield event loop between iterations so other requests can be served

    onStatus?.({ step: "Generating response", detail: `Sending to ${orchestration.providerLabel} with ${tools.length} tool(s)${iterations > 1 ? ` (iteration ${iterations})` : ""}` });
    let response: ChatResponse;
    try {
      response = await provider.chat(
        chatMessages,
        tools.length > 0 ? tools : undefined,
        SYSTEM_PROMPT + profileContext + knowledgeContext,
        onToken
      );
    } catch (primaryErr) {
      // Attempt fallback to another provider
      const fallback = deps.selectFallbackProvider(userMessage || "continuation", [orchestration.providerLabel], hasImages);
      if (fallback) {
        console.warn(`[agent] Primary provider ${orchestration.providerLabel} failed (${primaryErr instanceof Error ? primaryErr.message : primaryErr}), falling back to ${fallback.providerLabel}`);
        onStatus?.({ step: "Falling back", detail: `${orchestration.providerLabel} failed — trying ${fallback.providerLabel}` });
        orchestration = fallback;
        provider = fallback.provider;
        response = await provider.chat(
          chatMessages,
          tools.length > 0 ? tools : undefined,
          SYSTEM_PROMPT + profileContext + knowledgeContext,
          onToken
        );
      } else {
        throw primaryErr;
      }
    }

    if (response.content) {
      knowledgeSnippets.push(`[Assistant]\n${response.content}`);
    }

    // If LLM wants to call tools
    if (response.toolCalls.length > 0) {
      // Expand multi_tool_use.parallel into individual tool calls
      const { expandMultiToolUse } = await import("./discovery");
      const toolCalls = expandMultiToolUse(response.toolCalls);

      // Save the assistant message with tool calls
      const savedThinking = deps.addMessage({
        thread_id: threadId,
        role: "assistant",
        content: response.content,
        tool_calls: JSON.stringify(toolCalls),
        tool_results: null,
        attachments: null,
      });
      onMessage?.(savedThinking);

      chatMessages.push({
        role: "assistant",
        content: response.content || "",
        tool_calls: toolCalls,
      });

      // Process each tool call through the unified policy gatekeeper
      for (const toolCall of toolCalls) {
        await yieldLoop(); // yield between tool executions
        onStatus?.({ step: "Executing tool", detail: toolCall.name });
        const result = await deps.executeToolWithPolicy(toolCall, threadId, response.content || undefined);

        if (result.status === "pending_approval") {
          pendingApprovals.push(toolCall.name);
          chatMessages.push({
            role: "tool",
            content: `[PENDING APPROVAL] Action "${toolCall.name}" is awaiting owner approval.`,
            tool_call_id: toolCall.id,
          });
        } else if (result.status === "executed") {
          toolsUsed.push(toolCall.name);
          const processed = deps.processExecutedToolResult(toolCall, result.result, threadId, onMessage);
          screenshotAttachments.push(...processed.attachments);

          chatMessages.push({
            role: "tool",
            content: processed.llmContent,
            tool_call_id: toolCall.id,
          });

          // Exclude untrusted external content from knowledge ingestion to prevent vault poisoning
          if (!isUntrustedToolOutput(toolCall.name)) {
            const rawResult = JSON.stringify(result.result);
            knowledgeSnippets.push(`[Tool ${toolCall.name}]\n${rawResult.slice(0, 4000)}`);
          }
        } else {
          const errorContent = deps.processFailedToolResult(toolCall, result.error, threadId, onMessage);
          chatMessages.push({
            role: "tool",
            content: errorContent,
            tool_call_id: toolCall.id,
          });
        }
      }

      // If there are pending approvals, stop the loop
      if (pendingApprovals.length > 0) {
        const finalContent =
          response.content ||
          "I need your approval to proceed with some actions. Please check the Approval Inbox.";

        if (!response.content) {
          knowledgeSnippets.push(`[Assistant]\n${finalContent}`);
        }

        screenshotAttachments.length = 0;
        deps.persistKnowledgeFromTurn(threadId, knowledgeSnippets, userId).catch(() => {});
        return { content: finalContent, toolsUsed, pendingApprovals, attachments: [] };
      }

      continue; // Loop again to let LLM process tool results
    }

    // No tool calls — final response
    const finalText = response.content || "I have nothing to add.";
    const attachmentsForResponse = screenshotAttachments.map((att) => ({ ...att }));
    const finalContent = attachmentsForResponse.length > 0 ? "" : finalText;
    const finalAttachments = attachmentsForResponse.length > 0
      ? JSON.stringify(attachmentsForResponse)
      : null;
    const savedFinal = deps.addMessage({
      thread_id: threadId,
      role: "assistant",
      content: finalContent,
      tool_calls: null,
      tool_results: null,
      attachments: finalAttachments,
    });
    onMessage?.(savedFinal);

    // Persist screenshot attachments on the final assistant message too
    if (attachmentsForResponse.length > 0) {
      for (const att of attachmentsForResponse) {
        deps.addAttachment({
          id: crypto.randomUUID(), // new ID for this message's copy
          thread_id: threadId,
          message_id: savedFinal.id,
          filename: att.filename,
          mime_type: att.mimeType,
          size_bytes: att.sizeBytes,
          storage_path: att.storagePath,
        });
      }
    }
    // Clear for next iteration
    screenshotAttachments.length = 0;

    deps.addLog({
      level: "info",
      source: "agent",
      message: `Agent completed response in ${iterations} iteration(s).`,
      metadata: JSON.stringify({ threadId, toolsUsed }),
    });

    // Fire-and-forget: title generation and knowledge ingestion must NOT block
    // the response — the user already has the content, keeping the SSE open
    // just shows a lingering "Generating response" spinner.
    if (!continuation) {
      deps.maybeUpdateThreadTitle(threadId, queryText, finalText).catch(() => {});
    }
    deps.persistKnowledgeFromTurn(threadId, knowledgeSnippets, userId).catch(() => {});

    return { content: finalContent, toolsUsed, pendingApprovals, attachments: attachmentsForResponse };
  }

  // Max iterations reached
  const fallback = "I've reached the maximum number of tool iterations. Please try rephrasing your request.";
  const savedFallback = deps.addMessage({
    thread_id: threadId,
    role: "assistant",
    content: fallback,
    tool_calls: null,
    tool_results: null,
    attachments: null,
  });
  onMessage?.(savedFallback);

  knowledgeSnippets.push(`[Assistant]\n${fallback}`);
  deps.persistKnowledgeFromTurn(threadId, knowledgeSnippets, userId).catch(() => {});

  return { content: fallback, toolsUsed, pendingApprovals, attachments: [] };
}

/**
 * Resume the agent loop after a tool approval.
 * Loads thread history (including the now-saved tool result) and continues the LLM loop.
 */
export async function continueAgentLoop(threadId: string): Promise<AgentResponse> {
  // Resolve userId from the thread record
  const thread = getThread(threadId);
  const userId = thread?.user_id ?? undefined;
  return runAgentLoop(threadId, "", undefined, undefined, true, userId);
}

// Re-export for backward compatibility (loop-worker.ts, tests import from "./loop")
export { SYSTEM_PROMPT } from "./system-prompt";
export { dbMessagesToChat } from "./message-converter";
export { maybeUpdateThreadTitle } from "./title-generator";
export { persistKnowledgeFromTurn } from "./knowledge-persistence";
