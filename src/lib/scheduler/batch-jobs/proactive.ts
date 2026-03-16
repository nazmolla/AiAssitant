import { proactiveScanTool } from "@/lib/tools/proactive-scan-tool";
import {
  BatchJob,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";

export class ProactiveBatchJob extends BatchJob {
  readonly type = "proactive" as const;
  readonly defaultName = "Proactive Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:10:minute";

  canExecuteHandler(handlerName: string): boolean {
    return handlerName === "system.proactive.scan";
  }

  getHandlerNames(): string[] {
    return ["system.proactive.scan"];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const logCtx = { scheduleId: ctx.scheduleId, runId: ctx.runId, taskRunId: ctx.taskRunId, handlerName: ctx.handlerName };
    await proactiveScanTool.execute(proactiveScanTool.toolNamePrefix, {}, { threadId: "", userId: "" });
    log("info", "Proactive scan task completed successfully.", logCtx);
    return { outputJson: { kind: "proactive_scan" } };
  }

  protected createDefaultTasks(): BatchJobSubTaskTemplate[] {
    return [
      {
        task_key: "scan",
        name: "Run proactive scan",
        handler_name: "system.proactive.scan",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
      },
    ];
  }
}
