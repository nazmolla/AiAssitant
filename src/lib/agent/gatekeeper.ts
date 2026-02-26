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
import { isNetworkTool, executeBuiltinNetworkTool } from "./network-tools";
import { isEmailTool, executeBuiltinEmailTool } from "./email-tools";
import { isCustomTool, executeCustomTool } from "./custom-tools";
import {
  getToolPolicy,
  createApprovalRequest,
  updateThreadStatus,
  addLog,
  addMessage,
  getThread,
} from "@/lib/db";
import { notifyAdmin } from "@/lib/channels/notify";
import type { ToolCall } from "@/lib/llm";

export interface GatekeeperResult {
  status: "executed" | "pending_approval" | "error";
  result?: unknown;
  approvalId?: string;
  error?: string;
}

/** Redact sensitive fields from tool arguments before logging */
const SENSITIVE_KEYS = new Set(["password", "token", "secret", "api_key", "apiKey", "access_token", "accessToken", "private_key", "privateKey", "credentials"]);
function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    redacted[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "••••••" : value;
  }
  return redacted;
}

/** Truncate tool results to prevent logging huge payloads */
function truncateResult(result: unknown, maxLen = 500): string {
  const str = JSON.stringify(result);
  return str.length > maxLen ? str.slice(0, maxLen) + "...[truncated]" : str;
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

  // Default-deny for unknown tools: if no policy exists, require approval.
  // Built-in tools always have a policy row seeded at startup.
  // MCP tools get a policy when connected. Any tool without a policy is
  // treated as unknown and gated for safety.
  if (!policy || policy.requires_approval) {
    addLog({
      level: "info",
      source: "hitl",
      message: `Tool "${toolCall.name}" requires approval. Creating approval request.`,
      metadata: JSON.stringify({ threadId, args: redactArgs(toolCall.arguments) }),
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

    try {
      await notifyAdmin(
        `Approval required for tool ${toolCall.name}.\nThread: ${threadId}\nReason: ${reasoning || "(not provided)"}`,
        "Nexus Approval Required"
      );
    } catch {
      // non-blocking notification path
    }

    return {
      status: "pending_approval",
      approvalId: approval.id,
    };
  }

  // No approval needed — execute directly
  try {
    let result: unknown;
    if (isBuiltinWebTool(toolCall.name)) {
      result = await executeBuiltinWebTool(toolCall.name, toolCall.arguments);
    } else if (isBrowserTool(toolCall.name)) {
      result = await executeBrowserTool(toolCall.name, toolCall.arguments);
    } else if (isFsTool(toolCall.name)) {
      result = await executeBuiltinFsTool(toolCall.name, toolCall.arguments);
    } else if (isNetworkTool(toolCall.name)) {
      result = await executeBuiltinNetworkTool(toolCall.name, toolCall.arguments);
    } else if (isEmailTool(toolCall.name)) {
      const thread = getThread(threadId);
      result = await executeBuiltinEmailTool(toolCall.name, toolCall.arguments, thread?.user_id ?? undefined);
    } else if (isCustomTool(toolCall.name)) {
      result = await executeCustomTool(toolCall.name, toolCall.arguments);
    } else {
      result = await getMcpManager().callTool(
        toolCall.name,
        toolCall.arguments
      );
    }

    addLog({
      level: "info",
      source: "hitl",
      message: `Tool "${toolCall.name}" executed successfully.`,
      metadata: JSON.stringify({ threadId, result: truncateResult(result) }),
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
    } else if (isNetworkTool(toolName)) {
      result = await executeBuiltinNetworkTool(toolName, args);
    } else if (isEmailTool(toolName)) {
      const thread = getThread(threadId);
      result = await executeBuiltinEmailTool(toolName, args, thread?.user_id ?? undefined);
    } else if (isCustomTool(toolName)) {
      result = await executeCustomTool(toolName, args);
    } else {
      result = await getMcpManager().callTool(toolName, args);
    }

    // Resume the thread
    updateThreadStatus(threadId, "active");

    addLog({
      level: "info",
      source: "hitl",
      message: `Approved tool "${toolName}" executed successfully.`,
      metadata: JSON.stringify({ threadId, result: truncateResult(result) }),
    });

    return { status: "executed", result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Still unfreeze the thread — the approval was resolved, don't leave it stuck
    updateThreadStatus(threadId, "active");

    addLog({
      level: "error",
      source: "hitl",
      message: `Approved tool "${toolName}" failed: ${errorMsg}`,
      metadata: JSON.stringify({ threadId }),
    });

    return { status: "error", error: errorMsg };
  }
}
