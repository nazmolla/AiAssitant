/**
 * Email Batch Job
 *
 * Three-stage agent-driven pipeline that:
 *  1. Scans the inbox for new messages (uses builtin.email_read)
 *  2. Classifies each message by sender and intent
 *  3. Responds to known-user emails and notifies for unknown senders
 *
 * Architecture follows the job-scout PromptTool pipeline pattern:
 * all three steps share a single pipeline thread so each step can see
 * the full conversation history from prior steps.
 *
 * Called by:
 * - Unified scheduler engine via EmailBatchJob.executeStep()
 */

import {
  addMessage,
  createThread,
  getSchedulerScheduleById,
  getThreadMessages,
} from "@/lib/db";
import {
  BatchJob,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";
import { PromptTool } from "@/lib/tools/prompt-tool";

// ── PromptTool instances for each email pipeline stage ──────────────

const EMAIL_INBOX_SCAN_TOOL = new PromptTool({
  toolName: "builtin.workflow_email_inbox_scan",
  displayName: "Email Inbox Scanner",
  description: "Scan all configured email channels for new unread messages.",
  systemPrompt:
    "You are processing the email inbox for the Nexus system.\n\n" +
    "STEPS:\n" +
    "1. Use builtin.email_read with unreadOnly=true to fetch new messages from each configured email channel.\n" +
    "   If unreadOnly=true returns nothing, try unreadOnly=false with a recent 'since' date filter.\n" +
    "2. List EVERY email found with: sender address, subject, date, and a body snippet.\n" +
    "3. For each email, note whether the sender looks like a registered system user.\n" +
    "4. If NO emails are found, clearly state 'No new emails found in inbox.'\n" +
    "5. Do NOT reply, summarise, or take any action yet — only report what you received.",
});

const EMAIL_CLASSIFY_TOOL = new PromptTool({
  toolName: "builtin.workflow_email_classify",
  displayName: "Email Classifier",
  description: "Classify each email by sender type and determine what action is required.",
  systemPrompt:
    "Based on the emails reported earlier in this conversation thread:\n\n" +
    "1. For each email, determine:\n" +
    "   - SENDER TYPE: registered_user (known to the system) OR unknown_external\n" +
    "   - INTENT: question / request / notification / complaint / spam / personal / other\n" +
    "   - URGENCY: high / medium / low\n" +
    "   - REQUIRED ACTION: describe what to do, or 'none'\n\n" +
    "2. Group emails into two categories:\n" +
    "   - KNOWN USERS: emails from registered system users that need a direct response.\n" +
    "     Draft a clear, helpful reply for each (1–2 paragraphs).\n" +
    "   - UNKNOWN SENDERS: emails from external contacts.\n" +
    "     Recommend: ignore / notify_admin / send_info_reply, and explain why.\n\n" +
    "3. If no emails were reported in the conversation above, state 'No emails to classify.'",
});

const EMAIL_RESPOND_TOOL = new PromptTool({
  toolName: "builtin.workflow_email_respond",
  displayName: "Email Responder",
  description: "Send replies to known users and handle unknown-sender notifications.",
  systemPrompt:
    "Based on the email classification done earlier in this conversation thread:\n\n" +
    "1. For each KNOWN USER email that requires a response:\n" +
    "   - Use builtin.email_send to send the drafted reply.\n" +
    "   - Address the reply 'to' the sender's email address.\n" +
    "   - Include a relevant subject line (e.g. 'Re: <original subject>').\n\n" +
    "2. For each UNKNOWN SENDER email flagged as notify_admin or send_info_reply:\n" +
    "   - Use builtin.email_send to notify the system owner/admin with a brief summary.\n\n" +
    "3. If there are no emails to respond to, state 'No email responses required.'\n\n" +
    "4. Finish with a concise summary:\n" +
    "   - How many emails were processed\n" +
    "   - How many replies were sent\n" +
    "   - Any errors or items needing manual follow-up",
});

/** Map handler names → PromptTool instances for this pipeline. */
const STEP_TOOLS: ReadonlyMap<string, PromptTool> = new Map([
  ["workflow.email.inbox_scan", EMAIL_INBOX_SCAN_TOOL],
  ["workflow.email.classify", EMAIL_CLASSIFY_TOOL],
  ["workflow.email.respond", EMAIL_RESPOND_TOOL],
]);

export class EmailBatchJob extends BatchJob {
  readonly type = "email" as const;
  readonly defaultName = "Email Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:5:minute";

  canExecuteHandler(handlerName: string): boolean {
    return handlerName.startsWith("workflow.email.");
  }

  getHandlerNames(): string[] {
    return [
      "workflow.email.inbox_scan",
      "workflow.email.classify",
      "workflow.email.respond",
    ];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const { taskRunId, runId, handlerName, configJson, scheduleId } = ctx;
    const logCtx = { scheduleId, runId, taskRunId, handlerName };
    const stepKey = handlerName.replace("workflow.email.", "");

    const promptTool = STEP_TOOLS.get(handlerName);
    if (!promptTool) {
      throw new Error(`Unknown email batch step: "${handlerName}"`);
    }

    let stepUserId = "";
    let stepThreadId = ctx.pipelineThreadId ?? "";
    let additionalContext = "";

    try {
      const parsed = JSON.parse(configJson || "{}");
      if (typeof parsed.prompt === "string" && parsed.prompt) additionalContext = parsed.prompt;
      if (typeof parsed.userId === "string" && parsed.userId) stepUserId = parsed.userId;
    } catch { /* use defaults */ }

    if (!stepUserId) {
      const schedule = getSchedulerScheduleById(scheduleId);
      stepUserId = schedule?.owner_id ?? "";
    }
    if (!stepUserId) {
      throw new Error(`Missing userId for email batch step "${stepKey}". Set schedule owner_id.`);
    }

    // Create a shared pipeline thread on the first step; reuse for subsequent steps.
    if (!stepThreadId) {
      const schedule = getSchedulerScheduleById(scheduleId);
      const title = schedule ? `Email Batch: ${schedule.name}` : "Email Batch";
      stepThreadId = createThread(title, stepUserId, { threadType: "scheduled" }).id;
      log("info", `Created pipeline thread for email batch run.`, logCtx, { stepKey, threadId: stepThreadId });
    }

    const result = await promptTool.execute(promptTool.toolNamePrefix, {
      threadId: stepThreadId,
      userId: stepUserId,
      additionalContext,
    }, { threadId: stepThreadId, userId: stepUserId }) as { response: string; toolsUsed: string[] };

    const toolCallDetails = this.extractToolCallDetails(stepThreadId);

    log("info", `Email batch step "${stepKey}" completed.`, logCtx, {
      stepKey,
      threadId: stepThreadId,
      userId: stepUserId,
      toolsUsed: result.toolsUsed ?? [],
      toolCallDetails,
      response: result.response || "",
    });

    return {
      pipelineThreadId: stepThreadId,
      outputJson: {
        kind: "email_batch_pipeline",
        stepKey,
        threadId: stepThreadId,
        userId: stepUserId,
        toolsUsed: result.toolsUsed ?? [],
        toolCallDetails,
        response: result.response || "",
      },
    };
  }

  private extractToolCallDetails(threadId: string): Array<{ tool: string; args: Record<string, unknown> }> {
    const threadMsgs = getThreadMessages(threadId);
    const details: Array<{ tool: string; args: Record<string, unknown> }> = [];
    for (const msg of threadMsgs) {
      if (msg.tool_calls) {
        try {
          const calls = JSON.parse(msg.tool_calls);
          for (const tc of Array.isArray(calls) ? calls : [calls]) {
            if (tc?.name && tc?.arguments) {
              details.push({ tool: tc.name, args: tc.arguments });
            }
          }
        } catch { /* skip unparseable */ }
      }
    }
    return details;
  }

  protected createDefaultTasks(): BatchJobSubTaskTemplate[] {
    return [
      {
        task_key: "inbox_scan",
        name: "Receive Emails",
        handler_name: "workflow.email.inbox_scan",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
      },
      {
        task_key: "classify",
        name: "Match Users & Understand Emails",
        handler_name: "workflow.email.classify",
        execution_mode: "sync",
        sequence_no: 1,
        enabled: 1,
        depends_on_task_key: "inbox_scan",
      },
      {
        task_key: "respond",
        name: "Respond & Act",
        handler_name: "workflow.email.respond",
        execution_mode: "sync",
        sequence_no: 2,
        enabled: 1,
        depends_on_task_key: "classify",
      },
    ];
  }
}

