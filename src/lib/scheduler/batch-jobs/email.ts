/**
 * Email Batch Job
 *
 * Thin orchestrator — schedules and triggers email read/processing runs.
 * All execution logic lives in EmailReadTool (src/lib/tools/email-read-tool.ts).
 *
 * Called by:
 * - Unified scheduler engine via EmailBatchJob.executeStep()
 */

import { runEmailReadBatch } from "@/lib/tools/email-read-tool";
import {
  BatchJob,
  type BatchJobParameterDefinition,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";

export { runEmailReadBatch };

/* ── Batch Job Class ──────────────────────────────────────────────── */

export class EmailBatchJob extends BatchJob {
  readonly type = "email" as const;
  readonly defaultName = "Email Reading Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:5:minute";

  canExecuteHandler(handlerName: string): boolean {
    return handlerName === "system.email.read_incoming";
  }

  getHandlerNames(): string[] {
    return ["system.email.read_incoming"];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const logCtx = { scheduleId: ctx.scheduleId, runId: ctx.runId, taskRunId: ctx.taskRunId, handlerName: ctx.handlerName };
    await runEmailReadBatch({
      scheduleId: ctx.scheduleId,
      runId: ctx.runId,
      taskRunId: ctx.taskRunId,
      handlerName: ctx.handlerName,
    });
    log("info", "Email read task completed successfully.", logCtx);
    return { outputJson: { kind: "email_read_incoming" } };
  }

  override getParameterDefinitions(): BatchJobParameterDefinition[] {
    return [
      { key: "maxMessages", label: "Max Messages Per Run", type: "number", defaultValue: "25" },
    ];
  }

  protected createDefaultTasks(parameters: Record<string, string>): BatchJobSubTaskTemplate[] {
    return [
      {
        task_key: "email_read_incoming",
        name: "Read incoming email and respond",
        handler_name: "system.email.read_incoming",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
        config_json: { maxMessages: Number(parameters.maxMessages || "25") },
      },
    ];
  }
}
