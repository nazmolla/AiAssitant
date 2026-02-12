/**
 * Human-in-the-Loop Gatekeeper
 *
 * Wraps MCP tool calls with policy enforcement. If a tool requires approval,
 * the call is paused and an approval request is created. Execution resumes
 * only after the owner approves via the UI.
 */

import { getMcpManager } from "@/lib/mcp";
import {
  getToolPolicy,
  createApprovalRequest,
  updateThreadStatus,
  addLog,
  addMessage,
} from "@/lib/db";
import type { ToolCall } from "@/lib/llm";

export interface GatekeeperResult {
  status: "executed" | "pending_approval" | "error";
  result?: unknown;
  approvalId?: string;
  error?: string;
}

/**
 * Execute a tool call with HITL policy enforcement.
 */
export async function executeWithGatekeeper(
  toolCall: ToolCall,
  threadId: string,
  reasoning?: string
): Promise<GatekeeperResult> {
  const policy = getToolPolicy(toolCall.name);

  // If policy exists and requires approval
  if (policy && policy.requires_approval) {
    addLog({
      level: "info",
      source: "hitl",
      message: `Tool "${toolCall.name}" requires approval. Creating approval request.`,
      metadata: JSON.stringify({ threadId, args: toolCall.arguments }),
    });

    // Create an approval request
    const approval = createApprovalRequest({
      thread_id: threadId,
      tool_name: toolCall.name,
      args: JSON.stringify(toolCall.arguments),
      reasoning: reasoning || null,
    });

    // Freeze the thread
    updateThreadStatus(threadId, "awaiting_approval");

    // Add a system message to the thread
    addMessage({
      thread_id: threadId,
      role: "system",
      content: `⏸️ Action paused: "${toolCall.name}" requires your approval. Check the Approval Inbox.`,
      tool_calls: null,
      tool_results: null,
    });

    return {
      status: "pending_approval",
      approvalId: approval.id,
    };
  }

  // No approval needed — execute directly
  try {
    const result = await getMcpManager().callTool(
      toolCall.name,
      toolCall.arguments
    );

    addLog({
      level: "info",
      source: "hitl",
      message: `Tool "${toolCall.name}" executed successfully.`,
      metadata: JSON.stringify({ threadId, result }),
    });

    return { status: "executed", result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    addLog({
      level: "error",
      source: "hitl",
      message: `Tool "${toolCall.name}" failed: ${errorMsg}`,
      metadata: JSON.stringify({ threadId }),
    });

    return { status: "error", error: errorMsg };
  }
}

/**
 * Execute a previously approved tool call.
 */
export async function executeApprovedTool(
  toolName: string,
  args: Record<string, unknown>,
  threadId: string
): Promise<GatekeeperResult> {
  try {
    const result = await getMcpManager().callTool(toolName, args);

    // Resume the thread
    updateThreadStatus(threadId, "active");

    addLog({
      level: "info",
      source: "hitl",
      message: `Approved tool "${toolName}" executed successfully.`,
      metadata: JSON.stringify({ threadId, result }),
    });

    return { status: "executed", result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    addLog({
      level: "error",
      source: "hitl",
      message: `Approved tool "${toolName}" failed: ${errorMsg}`,
      metadata: JSON.stringify({ threadId }),
    });

    return { status: "error", error: errorMsg };
  }
}
