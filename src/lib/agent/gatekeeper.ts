/**
 * Human-in-the-Loop Gatekeeper
 *
 * Wraps MCP tool calls with policy enforcement. If a tool requires approval,
 * the call is paused and an approval request is created. Execution resumes
 * only after the owner approves via the UI.
 */

import { getMcpManager } from "@/lib/mcp";
import { isBuiltinWebTool, executeBuiltinWebTool } from "./web-tools";
import { isBrowserTool, executeBrowserTool } from "./browser-tools";
import { isFsTool, executeBuiltinFsTool } from "./fs-tools";
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

  // Default-deny: if no policy exists OR policy requires approval, ask for approval.
  // Tools must be explicitly marked as NOT requiring approval to auto-execute.
  if (!policy || policy.requires_approval) {
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

    // Build structured approval metadata for inline chat approve/reject
    const approvalMeta = JSON.stringify({
      approvalId: approval.id,
      tool_name: toolCall.name,
      args: toolCall.arguments,
      reasoning: reasoning || null,
    });

    // Add a system message to the thread with embedded approval data
    addMessage({
      thread_id: threadId,
      role: "system",
      content: `⏸️ Action paused: "${toolCall.name}" requires your approval.\n<!-- APPROVAL:${approvalMeta} -->`,
      tool_calls: null,
      tool_results: null,
      attachments: null,
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
    let result: unknown;

    // Route to the correct executor based on tool type
    if (isBuiltinWebTool(toolName)) {
      result = await executeBuiltinWebTool(toolName, args);
    } else if (isBrowserTool(toolName)) {
      result = await executeBrowserTool(toolName, args);
    } else if (isFsTool(toolName)) {
      result = await executeBuiltinFsTool(toolName, args);
    } else {
      result = await getMcpManager().callTool(toolName, args);
    }

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
