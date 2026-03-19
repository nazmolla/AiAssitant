/**
 * Inline approval flow orchestration for the agent loop.
 * Handles the approve/reject/guidance cycle when a thread is
 * awaiting user confirmation for a tool call.
 *
 * Extracted from loop.ts for SRP compliance.
 */

import {
  getThread,
  getThreadMessages,
  addMessage,
  updateThreadStatus,
  type Message,
  type AttachmentMeta,
} from "@/lib/db";
import {
  isAffirmativeApproval,
  isNegativeApproval,
  extractLatestInlineApproval,
} from "./approval-handler";
import type { AgentResponse } from "./loop";
import { TOOL_RESULT_TRUNCATION_LIMIT } from "@/lib/constants";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("agent.inline-approval-flow");

export type InlineApprovalResult =
  | { handled: false }
  | { handled: true; response: AgentResponse }
  | { handled: true; resumeContinuation: true };

/**
 * Process inline approval flow when a thread is awaiting user confirmation.
 * Returns `{ handled: false }` if there is no pending inline approval to process.
 * Returns `{ handled: true, response }` if the approval was resolved (guidance, cancellation, or failure).
 * Returns `{ handled: true, resumeContinuation: true }` if the tool was executed and the loop should resume.
 */
export async function processInlineApproval(
  threadId: string,
  userMessage: string,
  onMessage?: (msg: Message) => void,
  onStatus?: (status: { step: string; detail?: string }) => void
): Promise<InlineApprovalResult> {
  const t0 = Date.now();
  log.enter("processInlineApproval", { threadId });
  const thread = getThread(threadId);
  if (thread?.status !== "awaiting_user_confirmation") {
    log.exit("processInlineApproval", { handled: false }, Date.now() - t0);
    return { handled: false };
  }

  const inlinePayload = extractLatestInlineApproval(getThreadMessages(threadId));
  if (!inlinePayload) {
    updateThreadStatus(threadId, "active");
    log.exit("processInlineApproval", { handled: false, reason: "no payload" }, Date.now() - t0);
    return { handled: false };
  }

  // User message is not a clear approve/reject — ask for clarity
  if (!isAffirmativeApproval(userMessage) && !isNegativeApproval(userMessage)) {
    const guidance = `I need a clear decision for ${inlinePayload.tool_name}. Reply with "approve" to continue or "reject" to cancel.`;
    const guidanceMsg = addMessage({
      thread_id: threadId,
      role: "assistant",
      content: guidance,
      tool_calls: null,
      tool_results: null,
      attachments: null,
    });
    onMessage?.(guidanceMsg);
    return {
      handled: true,
      response: { content: guidance, toolsUsed: [], pendingApprovals: [], attachments: [] },
    };
  }

  // User rejected
  if (isNegativeApproval(userMessage)) {
    log.info("Inline approval rejected by user", { threadId, toolName: inlinePayload.tool_name });
    updateThreadStatus(threadId, "active");
    const cancelled = `Understood. I cancelled ${inlinePayload.tool_name}.`;
    const cancelledMsg = addMessage({
      thread_id: threadId,
      role: "assistant",
      content: cancelled,
      tool_calls: null,
      tool_results: null,
      attachments: null,
    });
    onMessage?.(cancelledMsg);
    log.exit("processInlineApproval", { handled: true, outcome: "rejected" }, Date.now() - t0);
    return {
      handled: true,
      response: { content: cancelled, toolsUsed: [], pendingApprovals: [], attachments: [] },
    };
  }

  // User approved — execute the tool
  log.info("Inline approval granted by user", { threadId, toolName: inlinePayload.tool_name });
  onStatus?.({ step: "Executing approved tool", detail: inlinePayload.tool_name });
  const { executeApprovedTool } = await import("./gatekeeper");
  const approvedResult = await executeApprovedTool(
    inlinePayload.tool_name,
    inlinePayload.args,
    threadId
  );

  if (approvedResult.status !== "executed") {
    log.error("Approved tool execution failed", { threadId, toolName: inlinePayload.tool_name, error: approvedResult.error });
    const failed = `Approval confirmed, but ${inlinePayload.tool_name} failed: ${approvedResult.error || "Unknown error"}`;
    const failedMsg = addMessage({
      thread_id: threadId,
      role: "assistant",
      content: failed,
      tool_calls: null,
      tool_results: null,
      attachments: null,
    });
    onMessage?.(failedMsg);
    log.exit("processInlineApproval", { handled: true, outcome: "failed" }, Date.now() - t0);
    return {
      handled: true,
      response: { content: failed, toolsUsed: [], pendingApprovals: [], attachments: [] },
    };
  }

  // Save the tool result and signal the loop to resume
  const toolPayloadRaw = JSON.stringify(approvedResult.result);
  const toolPayload =
    toolPayloadRaw.length > TOOL_RESULT_TRUNCATION_LIMIT
      ? toolPayloadRaw.slice(0, TOOL_RESULT_TRUNCATION_LIMIT) + "\n... [truncated]"
      : toolPayloadRaw;

  const toolMsg = addMessage({
    thread_id: threadId,
    role: "tool",
    content: toolPayload,
    tool_calls: null,
    tool_results: JSON.stringify({
      tool_call_id: inlinePayload.tool_call_id || `inline-${Date.now()}`,
      name: inlinePayload.tool_name,
      result: approvedResult.result,
    }),
    attachments: null,
  });
  onMessage?.(toolMsg);

  log.exit("processInlineApproval", { handled: true, outcome: "resumed" }, Date.now() - t0);
  return { handled: true, resumeContinuation: true };
}
