/**
 * Unified tool executor — checks policy, gates approval, and dispatches
 * to the correct executor via the tool registry.
 * Extracted from loop.ts for maintainability.
 */

import type { ToolCall } from "@/lib/llm";
import { getToolRegistry } from "./tool-registry";
import { extractApprovalReason } from "./approval-handler";
import { defaultToolExecutorDeps, type ToolExecutorDeps } from "./tool-executor-deps";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("agent.tool-executor");

/**
 * All tools (built-in + custom + MCP) now have policy entries in the DB,
 * so the same flow applies everywhere.
 */
export async function executeToolWithPolicy(
  toolCall: ToolCall,
  threadId: string,
  reasoning?: string,
  deps: ToolExecutorDeps = defaultToolExecutorDeps,
): Promise<import("./gatekeeper").GatekeeperResult> {
  const t0 = Date.now();
  log.enter("executeToolWithPolicy", { tool: toolCall.name, threadId });
  const { normalizeToolName } = await import("./discovery");

  // Normalize tool name — the LLM sometimes strips the "builtin." prefix
  toolCall = { ...toolCall, name: normalizeToolName(toolCall.name) };

  const reason = extractApprovalReason(reasoning, toolCall.arguments);
  const nlRequest = reason;

  const policy = deps.getToolPolicy(toolCall.name);

  if (policy && policy.requires_approval === 0) {
    deps.addLog({
      level: "info",
      source: "hitl",
      message: `Approval bypassed by policy for tool \"${toolCall.name}\" (requires_approval=0).`,
      metadata: JSON.stringify({ threadId }),
    });
  }

  // Default-deny: if no policy exists, require approval (matches gatekeeper behavior).
  if (!policy || policy.requires_approval) {
    const thread = deps.getThread(threadId);
    const requesterUser = thread?.user_id ? deps.getUserById(thread.user_id) : null;
    const requester = requesterUser?.display_name || requesterUser?.email || thread?.external_sender_id || "Unknown requester";
    const channel = thread?.channel_id ? deps.getChannel(thread.channel_id) : undefined;
    const source = thread?.thread_type === "interactive"
      ? "chat"
      : channel?.channel_type === "email"
        ? `email:${thread?.external_sender_id || requesterUser?.email || "unknown"}`
        : "proactive";

    const preferenceDecision = thread?.user_id
        ? deps.findApprovalPreferenceDecision(
          thread.user_id,
          toolCall.name,
          JSON.stringify(toolCall.arguments),
          reason || null,
          nlRequest
        )
      : null;

    if (preferenceDecision === "approved") {
      deps.addLog({
        level: "info",
        source: "hitl",
        message: `Auto-approved by saved preference for tool "${toolCall.name}".`,
        metadata: JSON.stringify({ threadId }),
      });
    }

    if (preferenceDecision === "rejected") {
      deps.addLog({
        level: "info",
        source: "hitl",
        message: `Auto-rejected by saved preference for tool "${toolCall.name}".`,
        metadata: JSON.stringify({ threadId }),
      });
      return { status: "error", error: `Auto-rejected by preference for ${toolCall.name}.` };
    }

    if (preferenceDecision === "ignored") {
      deps.addLog({
        level: "info",
        source: "hitl",
        message: `Auto-ignored by saved preference for tool "${toolCall.name}".`,
        metadata: JSON.stringify({ threadId }),
      });
      return { status: "executed", result: { status: "ignored", reason: "auto_ignored_by_preference" } };
    }

    if (preferenceDecision !== "approved") {
    if (!reason) {
      deps.addLog({
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

      deps.updateThreadStatus(threadId, "awaiting_user_confirmation");
      deps.addMessage({
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

      return { status: "pending_approval", approvalId: `inline-${threadId}-${Date.now()}` };
    }

    deps.addLog({
      level: "info",
      source: "hitl",
      message: `Tool "${toolCall.name}" requires approval (${source}).`,
      metadata: JSON.stringify({ threadId, args: toolCall.arguments, requester, source }),
    });

    const approval = deps.createApprovalRequest({
      thread_id: threadId,
      tool_name: toolCall.name,
      args: JSON.stringify(toolCall.arguments),
      reasoning: reason,
      nl_request: nlRequest,
      source,
    });

    const approvalMeta = JSON.stringify({
      approvalId: approval.id,
      tool_name: toolCall.name,
      args: toolCall.arguments,
      reasoning: reason,
      nl_request: nlRequest,
      requester,
      source,
    });

    // Only freeze interactive threads; proactive/email workflows stay asynchronous.
    if (thread?.thread_type === "interactive") {
      deps.updateThreadStatus(threadId, "awaiting_approval");
      deps.addMessage({
        thread_id: threadId,
        role: "system",
        content: `⏸️ Action paused: "${toolCall.name}" requires your approval.\n<!-- APPROVAL:${approvalMeta} -->`,
        tool_calls: null,
        tool_results: null,
        attachments: null,
      });
    }

    try {
      await deps.notifyAdmin(
        `Approval required for tool ${toolCall.name}.\nThread: ${threadId}\nRequester: ${requester}\nReason: ${reason}`,
        "Nexus Approval Required",
        { level: "medium", notificationType: "approval_required" }
      );
    } catch (err) {
      deps.addLog({
        level: "warning",
        source: "hitl",
        message: "Failed to send approval notification.",
        metadata: JSON.stringify({ toolName: toolCall.name, threadId, error: err instanceof Error ? err.message : String(err) }),
      });
    }

    return { status: "pending_approval", approvalId: approval.id };
    }
  }

  // No approval needed — route to the correct executor
  try {
    const result = await getToolRegistry().dispatch(
      toolCall.name,
      toolCall.arguments,
      { threadId }
    );

    deps.addLog({
      level: "info",
      source: "agent",
      message: `Tool "${toolCall.name}" executed successfully.`,
      metadata: JSON.stringify({ threadId }),
    });
    log.exit("executeToolWithPolicy", { status: "executed", tool: toolCall.name }, Date.now() - t0);
    return { status: "executed", result };
  } catch (err: any) {
    deps.addLog({
      level: "error",
      source: "agent",
      message: `Tool "${toolCall.name}" failed: ${err.message}`,
      metadata: JSON.stringify({ threadId }),
    });
    log.error("executeToolWithPolicy dispatch failed", { tool: toolCall.name, threadId }, err);
    return { status: "error", error: err.message };
  }
}
