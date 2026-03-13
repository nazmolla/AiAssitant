/**
 * Human-in-the-Loop Gatekeeper
 *
 * Wraps MCP tool calls with policy enforcement. If a tool requires approval,
 * the call is paused and an approval request is created. Execution resumes
 * only after the owner approves via the UI.
 */

import { getToolRegistry } from "./tool-registry";
import {
  getToolPolicy,
  createApprovalRequest,
  updateThreadStatus,
  addLog,
  addMessage,
  getThread,
  findApprovalPreferenceDecision,
} from "@/lib/db";
import { notifyAdmin } from "@/lib/channels/notify";
import type { ToolCall } from "@/lib/llm";
import { APPROVAL_REASON_MAX_CHARS } from "@/lib/constants";

export interface GatekeeperResult {
  status: "executed" | "pending_approval" | "error";
  result?: unknown;
  approvalId?: string;
  error?: string;
}

function extractApprovalReason(reasoning: string | undefined, args: Record<string, unknown>): string | null {
  const fromReasoning = (reasoning || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => !!line && !line.startsWith("{"));

  if (fromReasoning) return fromReasoning.slice(0, APPROVAL_REASON_MAX_CHARS);

  for (const key of ["reason", "rationale", "justification", "purpose", "why", "note", "message"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, APPROVAL_REASON_MAX_CHARS);
    }
  }

  return null;
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
  // Normalize tool name — the LLM sometimes strips the "builtin." prefix
  // Use lazy import to avoid circular dependency (gatekeeper → discovery → index → gatekeeper)
  const { normalizeToolName } = await import("./discovery");
  toolCall = { ...toolCall, name: normalizeToolName(toolCall.name) };
  const reason = extractApprovalReason(reasoning, toolCall.arguments);
  const nlRequest = reason;

  const policy = getToolPolicy(toolCall.name);

  if (policy && policy.requires_approval === 0) {
    addLog({
      level: "info",
      source: "hitl",
      message: `Approval bypassed by policy for tool \"${toolCall.name}\" (requires_approval=0).`,
      metadata: JSON.stringify({ threadId }),
    });
  }

  // Default-deny for unknown tools: if no policy exists, require approval.
  // Built-in tools always have a policy row seeded at startup.
  // MCP tools get a policy when connected. Any tool without a policy is
  // treated as unknown and gated for safety.
  if (!policy || policy.requires_approval) {
    const thread = getThread(threadId);
    const { getUserById, getChannel } = await import("@/lib/db");
    const requesterUser = thread?.user_id ? getUserById(thread.user_id) : null;
    const requester = requesterUser?.display_name || requesterUser?.email || thread?.external_sender_id || "Unknown requester";
    const channel = thread?.channel_id ? getChannel(thread.channel_id) : undefined;
    const source = thread?.thread_type === "interactive"
      ? "chat"
      : channel?.channel_type === "email"
        ? `email:${thread?.external_sender_id || requesterUser?.email || "unknown"}`
        : "proactive";

    const preferenceDecision = thread?.user_id
      ? findApprovalPreferenceDecision(
          thread.user_id,
          toolCall.name,
          JSON.stringify(toolCall.arguments),
          reason || null,
          nlRequest
        )
      : null;

    if (preferenceDecision === "approved") {
      addLog({
        level: "info",
        source: "hitl",
        message: `Auto-approved by saved preference for tool "${toolCall.name}".`,
        metadata: JSON.stringify({ threadId }),
      });
    }

    if (preferenceDecision === "rejected") {
      addLog({
        level: "info",
        source: "hitl",
        message: `Auto-rejected by saved preference for tool "${toolCall.name}".`,
        metadata: JSON.stringify({ threadId }),
      });
      return { status: "error", error: `Auto-rejected by preference for ${toolCall.name}.` };
    }

    if (preferenceDecision === "ignored") {
      addLog({
        level: "info",
        source: "hitl",
        message: `Auto-ignored by saved preference for tool "${toolCall.name}".`,
        metadata: JSON.stringify({ threadId }),
      });
      return { status: "executed", result: { status: "ignored", reason: "auto_ignored_by_preference" } };
    }

    if (preferenceDecision !== "approved") {
    if (!reason) {
      addLog({
        level: "warning",
        source: "hitl",
        message: `Skipped approval for tool "${toolCall.name}" because no reason was provided.`,
        metadata: JSON.stringify({ threadId, requester }),
      });
      return {
        status: "error",
        error: `Approval for ${toolCall.name} requires a clear reason. Ask again with a specific reason before requesting approval.`,
      };
    }

    if (source === "chat") {
      const inlineMeta = JSON.stringify({
        tool_name: toolCall.name,
        args: toolCall.arguments,
        reason,
        requester,
        source,
        tool_call_id: toolCall.id,
      });

      updateThreadStatus(threadId, "awaiting_user_confirmation");
      addMessage({
        thread_id: threadId,
        role: "system",
        content:
          `Approval needed to continue.\n` +
          `Requester: ${requester}\n` +
          `Action: ${toolCall.name}\n` +
          `Reason: ${reason}\n` +
          `Reply with \"approve\" to continue or \"reject\" to cancel.\n` +
          `<!-- INLINE_APPROVAL:${inlineMeta} -->`,
        tool_calls: null,
        tool_results: null,
        attachments: null,
      });

      return {
        status: "pending_approval",
        approvalId: `inline-${threadId}-${Date.now()}`,
      };
    }

    addLog({
      level: "info",
      source: "hitl",
      message: `Tool "${toolCall.name}" requires approval. Creating approval request (${source}).`,
      metadata: JSON.stringify({ threadId, args: redactArgs(toolCall.arguments), requester, source }),
    });

    // Create an approval request
    const approval = createApprovalRequest({
      thread_id: threadId,
      tool_name: toolCall.name,
      args: JSON.stringify(toolCall.arguments),
      reasoning: reason,
      nl_request: nlRequest,
      source,
    });

    // Freeze only interactive threads (non-interactive approvals are asynchronous).
    if (thread?.thread_type === "interactive") {
      updateThreadStatus(threadId, "awaiting_approval");
    }

    // Build structured approval metadata for inline chat approve/reject
    const approvalMeta = JSON.stringify({
      approvalId: approval.id,
      tool_name: toolCall.name,
      args: toolCall.arguments,
      reasoning: reason,
      nl_request: nlRequest,
      requester,
      source,
    });

    if (thread?.thread_type === "interactive") {
      // Add a system message to the thread with embedded approval data
      addMessage({
        thread_id: threadId,
        role: "system",
        content: `⏸️ Action paused: "${toolCall.name}" requires your approval.\n<!-- APPROVAL:${approvalMeta} -->`,
        tool_calls: null,
        tool_results: null,
        attachments: null,
      });
    }

    try {
      await notifyAdmin(
        `Approval required for tool ${toolCall.name}.\nThread: ${threadId}\nRequester: ${requester}\nReason: ${reason}`,
        "Nexus Approval Required",
        { level: "medium", notificationType: "approval_required" }
      );
    } catch {
      // non-blocking notification path
    }

    return {
      status: "pending_approval",
      approvalId: approval.id,
    };
    }
  }

  // No approval needed — execute directly
  try {
    const result = await getToolRegistry().dispatch(
      toolCall.name,
      toolCall.arguments,
      { threadId }
    );

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
    const result = await getToolRegistry().dispatch(
      toolName,
      args,
      { threadId }
    );

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
