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
} from "@/lib/llm";
import { getMcpManager } from "@/lib/mcp";
import { executeWithGatekeeper } from "./gatekeeper";
import {
  addMessage,
  getThreadMessages,
  searchKnowledge,
  addLog,
  type Message,
} from "@/lib/db";

const SYSTEM_PROMPT = `You are Nexus, a sovereign personal AI agent. You serve a single owner with deep personal knowledge and proactive intelligence.

Your capabilities:
- Access to external services via MCP tools (Email, GitHub, Azure, etc.)
- A persistent knowledge vault of user preferences and facts
- Ability to generate reminders and proactive suggestions
- Transparent reasoning: always explain WHY you want to take an action

Rules:
- Never make assumptions about the user's intent for sensitive actions
- If an action could have side effects, explain and let the HITL gatekeeper handle approval
- Reference known user preferences from the Knowledge Vault when relevant
- Be concise but thorough`;

const MAX_TOOL_ITERATIONS = 10;

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
  userMessage: string
): Promise<AgentResponse> {
  const provider = createChatProvider();
  const mcpManager = getMcpManager();
  const tools = mcpManager.getAllTools();

  // Save the user message
  addMessage({
    thread_id: threadId,
    role: "user",
    content: userMessage,
    tool_calls: null,
    tool_results: null,
  });

  // Build context from knowledge vault
  const relevantKnowledge = searchKnowledge(userMessage);
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
  const chatMessages = dbMessagesToChat(dbMessages);

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

    // If LLM wants to call tools
    if (response.toolCalls.length > 0) {
      // Save the assistant message with tool calls
      addMessage({
        thread_id: threadId,
        role: "assistant",
        content: response.content,
        tool_calls: JSON.stringify(response.toolCalls),
        tool_results: null,
      });

      chatMessages.push({
        role: "assistant",
        content: response.content || "",
      });

      // Process each tool call through the gatekeeper
      for (const toolCall of response.toolCalls) {
        const result = await executeWithGatekeeper(
          toolCall,
          threadId,
          response.content || undefined
        );

        if (result.status === "pending_approval") {
          pendingApprovals.push(toolCall.name);
          chatMessages.push({
            role: "tool",
            content: `[PENDING APPROVAL] Action "${toolCall.name}" is awaiting owner approval.`,
            tool_call_id: toolCall.id,
          });
        } else if (result.status === "executed") {
          toolsUsed.push(toolCall.name);
          const toolResult = JSON.stringify(result.result);

          addMessage({
            thread_id: threadId,
            role: "tool",
            content: toolResult,
            tool_calls: null,
            tool_results: JSON.stringify({ name: toolCall.name, result: result.result }),
          });

          chatMessages.push({
            role: "tool",
            content: toolResult,
            tool_call_id: toolCall.id,
          });
        } else {
          chatMessages.push({
            role: "tool",
            content: `[ERROR] Tool "${toolCall.name}" failed: ${result.error}`,
            tool_call_id: toolCall.id,
          });
        }
      }

      // If there are pending approvals, stop the loop
      if (pendingApprovals.length > 0) {
        const finalContent =
          response.content ||
          "I need your approval to proceed with some actions. Please check the Approval Inbox.";
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
    });

    addLog({
      level: "info",
      source: "agent",
      message: `Agent completed response in ${iterations} iteration(s).`,
      metadata: JSON.stringify({ threadId, toolsUsed }),
    });

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
  });

  return { content: fallback, toolsUsed, pendingApprovals };
}

function dbMessagesToChat(messages: Message[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content || "",
    tool_call_id: m.tool_results
      ? JSON.parse(m.tool_results)?.name
      : undefined,
  }));
}
