import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { selectProvider, selectProviderForWorker } from "@/lib/llm/orchestrator";
import type { ChatMessage, ChatResponse, ToolDefinition, ToolCall } from "@/lib/llm";
import { getMcpManager } from "@/lib/mcp";
import {
  BUILTIN_WEB_TOOLS, isBuiltinWebTool, executeBuiltinWebTool,
  BUILTIN_BROWSER_TOOLS, isBrowserTool, executeBrowserTool,
  BUILTIN_FS_TOOLS, isFsTool, executeBuiltinFsTool,
  BUILTIN_NETWORK_TOOLS, isNetworkTool, executeBuiltinNetworkTool,
  BUILTIN_EMAIL_TOOLS, isEmailTool, executeBuiltinEmailTool,
  BUILTIN_FILE_TOOLS, isFileTool, executeBuiltinFileTool,
  BUILTIN_ALEXA_TOOLS, isAlexaTool, executeAlexaTool,
  isCustomTool, executeCustomTool, getCustomToolDefinitions,
  isWorkerAvailable,
} from "@/lib/agent";
import { isWorkerAvailable as checkWorkerAvailable, runLlmInWorker, type WorkerToolResult } from "@/lib/agent/worker-manager";
import { buildCappedToolList, MAX_TOOLS_PER_REQUEST } from "@/lib/tools/tool-cap";
import { addLog, getUserById, listToolPolicies, getToolPolicy } from "@/lib/db";
import {
  VOICE_MAX_HISTORY_MESSAGES,
  VOICE_MAX_TOOL_ITERATIONS,
  VOICE_TURN_TIMEOUT_MS,
} from "@/lib/constants";
import { createSSEStream, sseResponse, sseEvent } from "@/lib/sse";

/**
 * POST /api/conversation/respond
 *
 * Streamlined, non-blocking LLM endpoint for voice conversation **with tools**.
 *
 * Unlike /api/threads/{id}/chat (which runs the full agent loop with knowledge
 * retrieval, embedding generation, profile context, message persistence, etc.),
 * this endpoint skips all that expensive overhead and goes straight to the LLM
 * with in-memory conversation history.
 *
 * What it KEEPS (vs full agent loop):
 *  - All tool definitions (builtins, MCP, custom)
 *  - Tool execution with approval policy checking
 *  - LLM streaming via SSE tokens
 *  - Multi-iteration tool calling loop
 *
 * What it SKIPS (the expensive parts):
 *  - Knowledge retrieval (embedding generation + cosine similarity search)
 *  - Detailed profile context loading
 *  - Thread/message DB persistence (history lives in client memory)
 *  - Auto thread title generation
 *  - Knowledge ingestion from conversation turns
 *
 * This keeps voice conversation fast and avoids blocking the Node.js event
 * loop with synchronous DB operations that the full agent loop performs.
 *
 * Accepts: { message: string, history?: Array<{role, content}> }
 * Returns: SSE stream with `token`, `tool_call`, `tool_result`, `done`,
 *          and `error` events.
 */

export const dynamic = "force-dynamic";

const CONVERSATION_SYSTEM_PROMPT = `You are Nexus, a helpful voice assistant having a natural spoken conversation.
Keep responses concise and conversational — you're speaking, not writing.
Avoid markdown formatting, code blocks, bullet points, and numbered lists unless the user explicitly asks for them.
Be warm, direct, and to the point. Respond as if you were talking face-to-face.
If the user asks a complex question, give a clear summary rather than a wall of text.
Keep most responses under 3-4 sentences unless the topic requires depth.
You have access to tools — use them when the user asks you to do something actionable (smart home, web search, network ops, etc.).
After using a tool, summarize what happened conversationally.`;

/** Yield the event loop so other requests can be processed */
const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

function extractApprovalReason(reasoning: string | undefined, args: Record<string, unknown>): string | null {
  const fromReasoning = (reasoning || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => !!line && !line.startsWith("{"));

  if (fromReasoning) return fromReasoning.slice(0, 500);

  for (const key of ["reason", "rationale", "justification", "purpose", "why", "note", "message"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 500);
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  let parsed: { message?: string; history?: Array<{ role: string; content: string }> };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, history } = parsed;

  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // Build chat messages from recent history + current message
  const chatMessages: ChatMessage[] = [];

  if (Array.isArray(history)) {
    const recent = history.slice(-VOICE_MAX_HISTORY_MESSAGES);
    for (const h of recent) {
      if (
        h &&
        typeof h.content === "string" &&
        (h.role === "user" || h.role === "assistant")
      ) {
        chatMessages.push({ role: h.role, content: h.content });
      }
    }
  }

  chatMessages.push({ role: "user", content: message.trim() });

  // Select best LLM provider — prefer fast cloud models for voice conversation
  // to ensure snappy real-time responses
  let orchestration;
  try {
    orchestration = selectProvider(message, false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  // Load tools — these are mostly in-memory singletons, not expensive
  await yieldLoop();
  const mcpTools = getMcpManager().getAllTools();
  const customTools = getCustomToolDefinitions();
  const builtinTools: ToolDefinition[] = [
    ...BUILTIN_WEB_TOOLS,
    ...BUILTIN_BROWSER_TOOLS,
    ...BUILTIN_FS_TOOLS,
    ...BUILTIN_NETWORK_TOOLS,
    ...BUILTIN_EMAIL_TOOLS,
    ...BUILTIN_FILE_TOOLS,
    ...BUILTIN_ALEXA_TOOLS,
  ];
  const allTools: ToolDefinition[] = buildCappedToolList(builtinTools, customTools, mcpTools, MAX_TOOLS_PER_REQUEST);

  // Filter tools by user role and approval policy.
  // Unknown tools (no policy) are excluded (default-deny).
  // Tools that require approval stay available, but are handled inline in the conversation.
  const isAdmin = auth.user.id ? (getUserById(auth.user.id)?.role === "admin") : true;
  const policyMap = new Map(listToolPolicies().map((p) => [p.tool_name, p]));
  const tools: ToolDefinition[] = allTools.filter((t) => {
    const policy = policyMap.get(t.name);
    if (!policy) return false;
    // Non-admin users only see global-scope tools
    if (!isAdmin && policy.scope === "user") return false;
    return true;
  });

  addLog({
    level: "info",
    source: "conversation",
    message: `Conversation request: "${message.slice(0, 80)}" → ${orchestration.providerLabel} (${tools.length} tools)`,
    metadata: JSON.stringify({ userId: auth.user.id, historyLength: chatMessages.length - 1 }),
  });

  // Stream response via SSE
  const sse = createSSEStream();

  // Fire-and-forget: run the conversation loop asynchronously
  (async () => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Conversation turn timed out")),
          VOICE_TURN_TIMEOUT_MS
        );
      });

      const conversationPromise = checkWorkerAvailable()
        ? runConversationLoopViaWorker(
            message,
            chatMessages,
            tools,
            sse.send,
            auth.user.id
          )
        : runConversationLoop(
            orchestration.provider,
            chatMessages,
            tools,
            sse.send,
            auth.user.id
          );

      await Promise.race([conversationPromise, timeoutPromise]);
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      sse.send(sseEvent("error", { error: msg }));
      addLog({
        level: "error",
        source: "conversation",
        message: `Conversation error: ${msg}`,
        metadata: JSON.stringify({ userId: auth.user.id }),
      });
    } finally {
      sse.close();
    }
  })();

  return sseResponse(sse);
}

/* ─── Conversation loop with tool support ──────────────────────────── */

async function runConversationLoop(
  provider: { chat: (messages: ChatMessage[], tools?: ToolDefinition[], systemPrompt?: string, onToken?: (token: string) => void | Promise<void>, requestOptions?: { disableThinking?: boolean }) => Promise<ChatResponse> },
  chatMessages: ChatMessage[],
  tools: ToolDefinition[],
  sseSend: (text: string) => void,
  userId: string
) {
  let iterations = 0;

  while (iterations < VOICE_MAX_TOOL_ITERATIONS) {
    iterations++;
    await yieldLoop(); // let other requests breathe

    const response = await provider.chat(
      chatMessages,
      tools.length > 0 ? tools : undefined,
      CONVERSATION_SYSTEM_PROMPT,
      async (token: string) => {
        sseSend(sseEvent("token", token));
      },
      { disableThinking: true }
    );

    // If LLM wants to call tools — execute them and loop back
    if (response.toolCalls.length > 0) {
      // Expand multi_tool_use.parallel into individual tool calls
      const { expandMultiToolUse } = await import("@/lib/agent/discovery");
      const toolCalls = expandMultiToolUse(response.toolCalls);

      // Notify client about tool calls
      for (const tc of toolCalls) {
        sseSend(sseEvent("tool_call", { name: tc.name, args: tc.arguments }));
      }

      // Add assistant message with tool calls to conversation
      chatMessages.push({
        role: "assistant",
        content: response.content || "",
        tool_calls: toolCalls,
      });

      // Execute each tool call
      for (const toolCall of toolCalls) {
        await yieldLoop(); // yield between tool executions

        const result = await executeConversationTool(toolCall, userId, response.content || undefined);

        if (result.status === "approval_required_inline") {
          const prompt = result.error || `This action requires your approval: ${toolCall.name}.`;
          sseSend(sseEvent("done", { content: prompt }));
          return;
        }

        const resultStr = JSON.stringify(result.result ?? result.error ?? "done");
        const truncatedResult = resultStr.length > 8000
          ? resultStr.slice(0, 8000) + "\n... [truncated]"
          : resultStr;

        sseSend(sseEvent("tool_result", { name: toolCall.name, success: result.status === "executed" }));

        chatMessages.push({
          role: "tool",
          content: truncatedResult,
          tool_call_id: toolCall.id,
        });
      }

      continue; // Loop again for the LLM to process tool results
    }

    // No tool calls — final response
    sseSend(sseEvent("done", { content: response.content }));

    addLog({
      level: "info",
      source: "conversation",
      message: `Conversation response: ${(response.content || "").length} chars, ${iterations} iteration(s)`,
      metadata: JSON.stringify({ userId }),
    });
    return;
  }

  // Max iterations reached
  sseSend(sseEvent("done", { content: "I've reached the maximum number of tool iterations for this turn." }));
}

/* ─── Execute tool in conversation context (no thread/DB persistence) ─ */

async function executeConversationTool(
  toolCall: ToolCall,
  userId: string,
  reasoning?: string
): Promise<{ status: string; result?: unknown; error?: string }> {
  try {
    // Normalize tool name — the LLM sometimes strips prefixes
    const { normalizeToolName } = await import("@/lib/agent/discovery");
    const normalized = normalizeToolName(toolCall.name);
    const tc = { ...toolCall, name: normalized };

    // Defense-in-depth: refuse any tool that requires approval (default-deny)
    const policy = getToolPolicy(tc.name);
    if (!policy || policy.requires_approval) {
      const reason = extractApprovalReason(reasoning, tc.arguments);
      if (!reason) {
        return {
          status: "approval_required_inline",
          error: `I need your approval to run ${tc.name}, but no clear reason was provided. Please ask again with why you want this action.`,
        };
      }
      return {
        status: "approval_required_inline",
        error: `Approval needed for ${tc.name}. Reason: ${reason}. Reply with an explicit approval request in this conversation to continue.`,
      };
    }

    let result: unknown;

    if (isBuiltinWebTool(tc.name)) {
      result = await executeBuiltinWebTool(tc.name, tc.arguments);
    } else if (isBrowserTool(tc.name)) {
      result = await executeBrowserTool(tc.name, tc.arguments);
    } else if (isFsTool(tc.name)) {
      result = await executeBuiltinFsTool(tc.name, tc.arguments);
    } else if (isNetworkTool(tc.name)) {
      result = await executeBuiltinNetworkTool(tc.name, tc.arguments);
    } else if (isEmailTool(tc.name)) {
      result = await executeBuiltinEmailTool(tc.name, tc.arguments, userId, undefined);
    } else if (isFileTool(tc.name)) {
      result = await executeBuiltinFileTool(tc.name, tc.arguments, {});
    } else if (isAlexaTool(tc.name)) {
      result = await executeAlexaTool(tc.name, tc.arguments);
    } else if (isCustomTool(tc.name)) {
      result = await executeCustomTool(tc.name, tc.arguments);
    } else {
      // MCP tool
      result = await getMcpManager().callTool(tc.name, tc.arguments);
    }

    addLog({
      level: "info",
      source: "conversation",
      message: `Tool "${tc.name}" executed via conversation mode.`,
      metadata: null,
    });
    return { status: "executed", result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog({
      level: "error",
      source: "conversation",
      message: `Tool "${toolCall.name}" failed in conversation: ${msg}`,
      metadata: null,
    });
    return { status: "error", error: msg };
  }
}

/* ─── Worker Thread variant for conversation loop ──────────────────── */

async function runConversationLoopViaWorker(
  message: string,
  chatMessages: ChatMessage[],
  tools: ToolDefinition[],
  sseSend: (text: string) => void,
  userId: string
) {
  const orchestration = selectProviderForWorker(message, false);

  const { promise } = runLlmInWorker(
    {
      provider: {
        providerType: orchestration.providerType,
        apiKey: (orchestration.providerConfig.apiKey as string) || "",
        model: orchestration.providerConfig.model as string | undefined,
        endpoint: orchestration.providerConfig.endpoint as string | undefined,
        deployment: orchestration.providerConfig.deployment as string | undefined,
        apiVersion: orchestration.providerConfig.apiVersion as string | undefined,
        baseURL: orchestration.providerConfig.baseURL as string | undefined,
        disableThinking: true,
      },
      systemPrompt: CONVERSATION_SYSTEM_PROMPT,
      messages: chatMessages,
      tools,
      maxIterations: VOICE_MAX_TOOL_ITERATIONS,
    },
    /* onToken */
    async (token: string) => {
      sseSend(sseEvent("token", token));
    },
    /* onStatus — not used for conversation */
    undefined,
    /* onToolRequest — execute tools in main thread */
    async (calls, _assistantContent) => {
      // Notify client about tool calls
      for (const tc of calls) {
        sseSend(sseEvent("tool_call", { name: tc.name, args: tc.arguments }));
      }

      const results: WorkerToolResult[] = [];
      for (const toolCall of calls) {
        const result = await executeConversationTool(toolCall, userId, _assistantContent || undefined);
        if (result.status === "approval_required_inline") {
          return [
            {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: JSON.stringify(result.error || `Approval required for ${toolCall.name}`),
            },
          ];
        }
        const resultStr = JSON.stringify(result.result ?? result.error ?? "done");
        const truncatedResult = resultStr.length > 8000
          ? resultStr.slice(0, 8000) + "\n... [truncated]"
          : resultStr;

        sseSend(sseEvent("tool_result", { name: toolCall.name, success: result.status === "executed" }));

        results.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: truncatedResult,
        });
      }
      return results;
    }
  );

  const workerResult = await promise;

  sseSend(sseEvent("done", { content: workerResult.content }));

  addLog({
    level: "info",
    source: "conversation",
    message: `Conversation response (worker): ${(workerResult.content || "").length} chars, ${workerResult.iterations} iteration(s)`,
    metadata: JSON.stringify({ userId }),
  });
}
