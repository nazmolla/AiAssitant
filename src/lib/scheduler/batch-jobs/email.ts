/**
 * Email Batch Job
 *
 * Orchestrator-driven email management workflow.
 * The orchestrator dispatches specialized agents (email_manager, etc.)
 * to scan the inbox, classify messages, and respond as needed.
 *
 * Called by:
 * - Unified scheduler engine via EmailBatchJob.executeStep()
 */

import {
  createThread,
  getSchedulerScheduleById,
} from "@/lib/db";
import {
  BatchJob,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";
import { OrchestratorAgent, AgentRegistry } from "@/lib/agent/multi-agent";

/* ── Email management task description for the orchestrator ───── */

const EMAIL_TASK =
  "Manage the email inbox: scan for unread messages, classify each by sender and intent, " +
  "and respond appropriately.\n\n" +
  "Steps to complete:\n" +
  "1. Scan: Use email_manager to fetch all unread emails from every configured channel. " +
  "List each email with sender, subject, date, and a short body snippet.\n" +
  "2. Classify: For each email determine sender type (registered user / external), " +
  "intent (question / request / notification / complaint / spam / other), urgency, and required action.\n" +
  "3. Respond: Send replies to emails from known registered users. " +
  "For unknown external senders, notify the admin with a summary.\n" +
  "4. Report: Finish with a concise summary — how many emails processed, how many replies sent, " +
  "and any items needing manual follow-up.";

export class EmailBatchJob extends BatchJob {
  readonly type = "email" as const;
  readonly defaultName = "Email Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:5:minute";

  canExecuteHandler(handlerName: string): boolean {
    return handlerName === "workflow.email.run";
  }

  getHandlerNames(): string[] {
    return ["workflow.email.run"];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const { taskRunId, runId, handlerName, configJson, scheduleId } = ctx;
    const logCtx = { scheduleId, runId, taskRunId, handlerName };

    let userId = "";
    let additionalContext = "";
    const threadId = ctx.pipelineThreadId ?? "";

    try {
      const parsed = JSON.parse(configJson || "{}");
      if (typeof parsed.prompt === "string" && parsed.prompt) additionalContext = parsed.prompt;
      if (typeof parsed.userId === "string" && parsed.userId) userId = parsed.userId;
    } catch { /* use defaults */ }

    if (!userId) {
      const schedule = getSchedulerScheduleById(scheduleId);
      userId = schedule?.owner_id ?? "";
    }
    if (!userId) {
      throw new Error("Missing userId for email batch. Set schedule owner_id.");
    }

    let runThreadId = threadId;
    if (!runThreadId) {
      const schedule = getSchedulerScheduleById(scheduleId);
      const title = schedule ? `Email Batch: ${schedule.name}` : "Email Batch";
      runThreadId = createThread(title, userId, { threadType: "scheduled" }).id;
      log("info", "Created pipeline thread for email batch run.", logCtx, { threadId: runThreadId });
    }

    const registry = AgentRegistry.getInstance();
    const orchestrator = new OrchestratorAgent(registry);
    const result = await orchestrator.run(
      additionalContext ? `${EMAIL_TASK}\n\n## User context\n${additionalContext}` : EMAIL_TASK,
      { userId, threadId: runThreadId },
    );

    log("info", "Email batch orchestration completed.", logCtx, {
      threadId: result.threadId,
      agentsDispatched: result.agentsDispatched,
      toolsUsed: result.toolsUsed,
      response: result.response.slice(0, 500),
    });

    return {
      pipelineThreadId: result.threadId,
      outputJson: {
        kind: "email_batch_orchestrated",
        threadId: result.threadId,
        userId,
        agentsDispatched: result.agentsDispatched,
        toolsUsed: result.toolsUsed,
        response: result.response,
      },
    };
  }

  protected createDefaultTasks(): BatchJobSubTaskTemplate[] {
    return [
      {
        task_key: "run",
        name: "Email Batch",
        handler_name: "workflow.email.run",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
      },
    ];
  }
}

