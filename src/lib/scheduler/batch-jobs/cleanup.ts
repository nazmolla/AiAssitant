import { runDbMaintenanceIfDue } from "@/lib/db";
import {
  BatchJob,
  type BatchJobParameterDefinition,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";

export class CleanupBatchJob extends BatchJob {
  readonly type = "cleanup" as const;
  readonly defaultName = "Log Cleanup Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:1:day";

  canExecuteHandler(handlerName: string): boolean {
    return handlerName === "system.db_maintenance.run_due";
  }

  getHandlerNames(): string[] {
    return ["system.db_maintenance.run_due"];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const logCtx = { scheduleId: ctx.scheduleId, runId: ctx.runId, taskRunId: ctx.taskRunId, handlerName: ctx.handlerName };
    const result = runDbMaintenanceIfDue();
    log("info", "DB maintenance task completed.", logCtx, {
      maintenanceSkipped: result === null,
      ...(result || {}),
    });
    return { outputJson: { kind: "db_maintenance", result } };
  }

  override getParameterDefinitions(): BatchJobParameterDefinition[] {
    return [
      { key: "logLevel", label: "Log Level", type: "select", options: ["verbose", "info", "warning", "error"], defaultValue: "warning" },
    ];
  }

  protected createDefaultTasks(parameters: Record<string, string>): BatchJobSubTaskTemplate[] {
    return [
      {
        task_key: "cleanup_prompt",
        name: "Prompt cleanup agent",
        handler_name: "agent.prompt",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
        task_type: "prompt",
        prompt: `Perform log cleanup and retention validation for level ${parameters.logLevel || "warning"}.`,
        config_json: { prompt: `Perform log cleanup and retention validation for level ${parameters.logLevel || "warning"}.` },
      },
      {
        task_key: "db_maintenance",
        name: "Run DB maintenance if due",
        handler_name: "system.db_maintenance.run_due",
        execution_mode: "sync",
        sequence_no: 1,
        enabled: 1,
        depends_on_task_key: "cleanup_prompt",
      },
    ];
  }
}
