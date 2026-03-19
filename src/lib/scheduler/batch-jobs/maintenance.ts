import {
  BatchJob,
  type BatchJobParameterDefinition,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";
import { createLogger } from "@/lib/logging/logger";

const slog = createLogger("scheduler.batch-jobs.maintenance");

/**
 * Unified maintenance batch job for all system maintenance:
 * - Knowledge vault re-indexing and validation
 * - Database log cleanup and retention enforcement
 *
 * Replaces separate KnowledgeBatchJob and CleanupBatchJob.
 */
export class MaintenanceBatchJob extends BatchJob {
  readonly type = "maintenance" as const;
  readonly defaultName = "System Maintenance Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:1:hour";

  canExecuteHandler(handlerName: string): boolean {
    return (
      handlerName === "system.knowledge_maintenance.run_due" ||
      handlerName === "system.db_maintenance.run_due"
    );
  }

  getHandlerNames(): string[] {
    return [
      "system.knowledge_maintenance.run_due",
      "system.db_maintenance.run_due",
    ];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const t0 = Date.now();
    slog.enter("MaintenanceBatchJob.executeStep", { handlerName: ctx.handlerName });
    const logCtx = { scheduleId: ctx.scheduleId, runId: ctx.runId, taskRunId: ctx.taskRunId, handlerName: ctx.handlerName };

    if (ctx.handlerName === "system.knowledge_maintenance.run_due") {
      const { runKnowledgeMaintenanceIfDue } = await import("@/lib/knowledge-maintenance");
      const result = runKnowledgeMaintenanceIfDue();
      log("info", "Knowledge maintenance completed.", logCtx, { ...result } as Record<string, unknown>);
      slog.info("Knowledge maintenance completed", { ...result } as Record<string, unknown>);
      slog.exit("MaintenanceBatchJob.executeStep", { handlerName: ctx.handlerName }, Date.now() - t0);
      return { outputJson: { kind: "knowledge_maintenance", result } };
    }

    if (ctx.handlerName === "system.db_maintenance.run_due") {
      const { runDbMaintenanceIfDue } = await import("@/lib/db");
      const result = runDbMaintenanceIfDue();
      log("info", "DB maintenance task completed.", logCtx, {
        maintenanceSkipped: result === null,
        ...(result || {}),
      });
      slog.info("DB maintenance task completed", { maintenanceSkipped: result === null });
      slog.exit("MaintenanceBatchJob.executeStep", { handlerName: ctx.handlerName }, Date.now() - t0);
      return { outputJson: { kind: "db_maintenance", result } };
    }

    throw new Error(`Unknown handler: ${ctx.handlerName}`);
  }

  override getParameterDefinitions(): BatchJobParameterDefinition[] {
    return [];
  }

  protected createDefaultTasks(parameters: Record<string, string>): BatchJobSubTaskTemplate[] {
    return [
      {
        task_key: "knowledge_maintenance",
        name: "Knowledge maintenance",
        handler_name: "system.knowledge_maintenance.run_due",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
        config_json: {},
      },
      {
        task_key: "db_maintenance",
        name: "Database maintenance",
        handler_name: "system.db_maintenance.run_due",
        execution_mode: "sync",
        sequence_no: 1,
        enabled: 1,
        config_json: {},
      },
    ];
  }
}
