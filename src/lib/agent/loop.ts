/**
 * Nexus Agent Core Loop
 *
 * Implements the Sense-Think-Act loop:
 * 1. Receives user message
 * 2. Builds context (knowledge, thread history)
 * 3. Calls LLM with available MCP tools
 * 4. Processes tool calls through HITL gatekeeper
 * 5. Iterates until LLM produces a final response
 */

import {
  createChatProvider,
  type ChatMessage,
  type ChatResponse,
  type ToolCall,
  type ContentPart,
} from "@/lib/llm";
import { getMcpManager } from "@/lib/mcp";
import { executeWithGatekeeper } from "./gatekeeper";
import { BUILTIN_WEB_TOOLS, isBuiltinWebTool, executeBuiltinWebTool } from "./web-tools";
import { BUILTIN_BROWSER_TOOLS, isBrowserTool, executeBrowserTool } from "./browser-tools";
import {
  addMessage,
  getThreadMessages,
  addLog,
  addAttachment,
  type Message,
  type AttachmentMeta,
} from "@/lib/db";
import { ingestKnowledgeFromText } from "@/lib/knowledge";
import { retrieveKnowledge } from "@/lib/knowledge/retriever";

const SYSTEM_PROMPT = `You are Nexus, a sovereign personal AI agent. You serve a single owner with deep personal knowledge and proactive intelligence.

Your capabilities:
- Access to external services via MCP tools (Email, GitHub, Azure, etc.)
- Web search: search the internet for current information, news, facts
- Web browsing: fetch and read web pages, extract specific information from URLs
- Full browser automation: navigate websites, click buttons, fill forms, submit applications, create accounts, upload files — like a human using a real browser
- A persistent knowledge vault of user preferences and facts
- Ability to generate reminders and proactive suggestions
- Transparent reasoning: always explain WHY you want to take an action

Browser automation guidelines:
- Use browser_navigate to open a website, then browser_get_elements to discover what you can interact with
- Use browser_type and browser_fill_form to enter data into forms
- Use browser_click to click buttons and links
- Use browser_get_content to read page text
- For multi-step workflows (e.g., job applications), work step by step: navigate → read → fill → submit
- Use browser_screenshot if you need to visually verify the page state
- Always browser_close when you're done with a browsing session
- If a page requires login, inform the user and ask for credentials rather than guessing

Rules:
- Never make assumptions about the user's intent for sensitive actions
- If an action could have side effects, explain and let the HITL gatekeeper handle approval
- Reference known user preferences from the Knowledge Vault when relevant
- When asked about current events, real-time data, or anything you're unsure about, use web_search
- When the user shares a URL or asks about a specific webpage, use web_fetch or web_extract
- For complex web interactions (filling forms, applying to jobs, creating profiles), use the browser tools
- Be concise but thorough`;

const MAX_TOOL_ITERATIONS = 25;

export interface AgentResponse {
  content: string;
  toolsUsed: string[];
  pendingApprovals: string[];
}

/**
 * Run the agent loop for a given thread and user message.
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
  }>
): Promise<AgentResponse> {
  const provider = createChatProvider();
  const mcpManager = getMcpManager();
  const mcpTools = mcpManager.getAllTools();
  const tools = [...BUILTIN_WEB_TOOLS, ...BUILTIN_BROWSER_TOOLS, ...mcpTools];

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
  const savedMsg = addMessage({
    thread_id: threadId,
    role: "user",
    content: userMessage,
    tool_calls: null,
    tool_results: null,
    attachments: attachmentsMeta ? JSON.stringify(attachmentsMeta) : null,
  });

  // Persist attachment records in the attachments table
  if (attachmentsMeta) {
    for (const att of attachmentsMeta) {
      addAttachment({
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

  const knowledgeSnippets: string[] = [`[User]\n${userMessage}`];

  // Build context from knowledge vault
  const relevantKnowledge = await retrieveKnowledge(userMessage, 8);
  let knowledgeContext = "";
  if (relevantKnowledge.length > 0) {
    knowledgeContext =
      "\n\n[Knowledge Vault Context]\n" +
      relevantKnowledge
        .map((k) => `- ${k.entity} / ${k.attribute}: ${k.value}`)
        .join("\n");
  }

  // Build message history
  const dbMessages = getThreadMessages(threadId);
  const chatMessages = dbMessagesToChat(dbMessages, contentParts);

  const toolsUsed: string[] = [];
  const pendingApprovals: string[] = [];
  let iterations = 0;

  addLog({
    level: "thought",
    source: "agent",
    message: `Processing user message in thread ${threadId}`,
    metadata: JSON.stringify({ messagePreview: userMessage.substring(0, 100) }),
  });

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response: ChatResponse = await provider.chat(
      chatMessages,
      tools.length > 0 ? tools : undefined,
      SYSTEM_PROMPT + knowledgeContext
    );

    if (response.content) {
      knowledgeSnippets.push(`[Assistant]\n${response.content}`);
    }

    // If LLM wants to call tools
    if (response.toolCalls.length > 0) {
      // Save the assistant message with tool calls
      addMessage({
        thread_id: threadId,
        role: "assistant",
        content: response.content,
        tool_calls: JSON.stringify(response.toolCalls),
        tool_results: null,
        attachments: null,
      });

      chatMessages.push({
        role: "assistant",
        content: response.content || "",
        tool_calls: response.toolCalls,
      });

      // Process each tool call through the gatekeeper
      for (const toolCall of response.toolCalls) {
        // Built-in web/browser tools execute locally, bypass MCP but still respect gatekeeper
        const result = isBuiltinWebTool(toolCall.name)
          ? await executeBuiltinTool(toolCall, threadId, response.content || undefined)
          : isBrowserTool(toolCall.name)
            ? await executeBuiltinBrowserTool(toolCall, threadId, response.content || undefined)
            : await executeWithGatekeeper(toolCall, threadId, response.content || undefined);

        if (result.status === "pending_approval") {
          pendingApprovals.push(toolCall.name);
          chatMessages.push({
            role: "tool",
            content: `[PENDING APPROVAL] Action "${toolCall.name}" is awaiting owner approval.`,
            tool_call_id: toolCall.id,
          });
        } else if (result.status === "executed") {
          toolsUsed.push(toolCall.name);
          const toolResultRaw = JSON.stringify(result.result);
          // Truncate tool results to avoid blowing up LLM context
          const toolResult = toolResultRaw.length > 15000
            ? toolResultRaw.slice(0, 15000) + "\n... [truncated]"
            : toolResultRaw;

          addMessage({
            thread_id: threadId,
            role: "tool",
            content: toolResult,
            tool_calls: null,
            tool_results: JSON.stringify({ tool_call_id: toolCall.id, name: toolCall.name, result: result.result }),
            attachments: null,
          });

          chatMessages.push({
            role: "tool",
            content: toolResult,
            tool_call_id: toolCall.id,
          });

          knowledgeSnippets.push(`[Tool ${toolCall.name}]\n${toolResult.slice(0, 4000)}`);
        } else {
          // Persist error results to DB so history is complete
          const errorContent = `[ERROR] Tool "${toolCall.name}" failed: ${result.error}`;
          addMessage({
            thread_id: threadId,
            role: "tool",
            content: errorContent,
            tool_calls: null,
            tool_results: JSON.stringify({ tool_call_id: toolCall.id, name: toolCall.name, error: result.error }),
            attachments: null,
          });

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

        await persistKnowledgeFromTurn(threadId, knowledgeSnippets);
        return { content: finalContent, toolsUsed, pendingApprovals };
      }

      continue; // Loop again to let LLM process tool results
    }

    // No tool calls — final response
    const finalContent = response.content || "I have nothing to add.";
    addMessage({
      thread_id: threadId,
      role: "assistant",
      content: finalContent,
      tool_calls: null,
      tool_results: null,
      attachments: null,
    });

    addLog({
      level: "info",
      source: "agent",
      message: `Agent completed response in ${iterations} iteration(s).`,
      metadata: JSON.stringify({ threadId, toolsUsed }),
    });

    await persistKnowledgeFromTurn(threadId, knowledgeSnippets);
    return { content: finalContent, toolsUsed, pendingApprovals };
  }

  // Max iterations reached
  const fallback = "I've reached the maximum number of tool iterations. Please try rephrasing your request.";
  addMessage({
    thread_id: threadId,
    role: "assistant",
    content: fallback,
    tool_calls: null,
    tool_results: null,
    attachments: null,
  });

  knowledgeSnippets.push(`[Assistant]\n${fallback}`);
  await persistKnowledgeFromTurn(threadId, knowledgeSnippets);

  return { content: fallback, toolsUsed, pendingApprovals };
}

function dbMessagesToChat(
  messages: Message[],
  latestContentParts?: ContentPart[]
): ChatMessage[] {
  const result: ChatMessage[] = [];
  // Track which tool_call_ids are present in assistant messages
  const knownToolCallIds = new Set<string>();

  // First pass: collect known tool_call_ids from assistant messages
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls) {
      try {
        const tcs: ToolCall[] = JSON.parse(m.tool_calls);
        for (const tc of tcs) {
          knownToolCallIds.add(tc.id);
        }
      } catch {}
    }
  }

  for (let idx = 0; idx < messages.length; idx++) {
    const m = messages[idx];
    const isLast = idx === messages.length - 1;

    // Skip system messages — system prompt is injected separately
    if (m.role === "system") continue;

    // Parse tool_calls from the DB if stored on an assistant message
    let toolCalls: ToolCall[] | undefined;
    if (m.role === "assistant" && m.tool_calls) {
      try {
        toolCalls = JSON.parse(m.tool_calls);
      } catch {}
    }

    // Parse tool_call_id for tool messages
    if (m.role === "tool") {
      let toolCallId: string | undefined;
      if (m.tool_results) {
        try {
          const tr = JSON.parse(m.tool_results);
          toolCallId = tr.tool_call_id;
        } catch {}
      }
      // Skip tool messages that don't have a valid tool_call_id
      // or whose tool_call_id doesn't match a known assistant tool call
      if (!toolCallId || !knownToolCallIds.has(toolCallId)) continue;

      result.push({
        role: "tool",
        content: m.content || "",
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

  return result;
}

/**
 * Execute a built-in browser tool.
 * Goes through gatekeeper policy check first.
 */
async function executeBuiltinBrowserTool(
  toolCall: ToolCall,
  threadId: string,
  reasoning?: string
): Promise<import("./gatekeeper").GatekeeperResult> {
  const { getToolPolicy, createApprovalRequest, updateThreadStatus, addMessage: addMsg } = await import("@/lib/db");
  const policy = getToolPolicy(toolCall.name);

  if (policy && policy.requires_approval) {
    addLog({
      level: "info",
      source: "hitl",
      message: `Browser tool "${toolCall.name}" requires approval.`,
      metadata: JSON.stringify({ threadId, args: toolCall.arguments }),
    });

    const approval = createApprovalRequest({
      thread_id: threadId,
      tool_name: toolCall.name,
      args: JSON.stringify(toolCall.arguments),
      reasoning: reasoning || null,
    });

    updateThreadStatus(threadId, "awaiting_approval");
    addMsg({
      thread_id: threadId,
      role: "system",
      content: `\u23f8\ufe0f Action paused: "${toolCall.name}" requires your approval.`,
      tool_calls: null,
      tool_results: null,
      attachments: null,
    });

    return { status: "pending_approval", approvalId: approval.id };
  }

  try {
    const result = await executeBrowserTool(toolCall.name, toolCall.arguments);
    addLog({
      level: "info",
      source: "agent",
      message: `Browser tool "${toolCall.name}" executed successfully.`,
      metadata: JSON.stringify({ threadId }),
    });
    return { status: "executed", result };
  } catch (err: any) {
    addLog({
      level: "error",
      source: "agent",
      message: `Browser tool "${toolCall.name}" failed: ${err.message}`,
      metadata: JSON.stringify({ threadId }),
    });
    return { status: "error", error: err.message };
  }
}

/**
 * Execute a built-in tool (web_search, web_fetch, web_extract).
 * Goes through gatekeeper policy check first.
 */
async function executeBuiltinTool(
  toolCall: ToolCall,
  threadId: string,
  reasoning?: string
): Promise<import("./gatekeeper").GatekeeperResult> {
  // Check policy first (same as gatekeeper)
  const { getToolPolicy, createApprovalRequest, updateThreadStatus, addMessage: addMsg } = await import("@/lib/db");
  const policy = getToolPolicy(toolCall.name);

  if (policy && policy.requires_approval) {
    addLog({
      level: "info",
      source: "hitl",
      message: `Built-in tool "${toolCall.name}" requires approval.`,
      metadata: JSON.stringify({ threadId, args: toolCall.arguments }),
    });

    const approval = createApprovalRequest({
      thread_id: threadId,
      tool_name: toolCall.name,
      args: JSON.stringify(toolCall.arguments),
      reasoning: reasoning || null,
    });

    updateThreadStatus(threadId, "awaiting_approval");
    addMsg({
      thread_id: threadId,
      role: "system",
      content: `⏸️ Action paused: "${toolCall.name}" requires your approval.`,
      tool_calls: null,
      tool_results: null,
      attachments: null,
    });

    return { status: "pending_approval", approvalId: approval.id };
  }

  // Execute directly
  try {
    const result = await executeBuiltinWebTool(toolCall.name, toolCall.arguments);
    addLog({
      level: "info",
      source: "agent",
      message: `Built-in tool "${toolCall.name}" executed successfully.`,
      metadata: JSON.stringify({ threadId }),
    });
    return { status: "executed", result };
  } catch (err: any) {
    addLog({
      level: "error",
      source: "agent",
      message: `Built-in tool "${toolCall.name}" failed: ${err.message}`,
      metadata: JSON.stringify({ threadId }),
    });
    return { status: "error", error: err.message };
  }
}

async function persistKnowledgeFromTurn(
  threadId: string,
  snippets: string[]
): Promise<void> {
  const payload = snippets.join("\n\n").slice(0, 8000);
  if (!payload.trim()) return;
  await ingestKnowledgeFromText({
    source: `chat:${threadId}`,
    text: payload,
    contextHint: "Extract durable owner knowledge from this conversation turn.",
  });
}
