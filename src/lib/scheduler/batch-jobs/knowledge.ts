import { knowledgeMaintenanceTool } from "@/lib/tools/knowledge-maintenance-tool";
import {
  BatchJob,
  type BatchJobParameterDefinition,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";

export class KnowledgeBatchJob extends BatchJob {
  readonly type = "knowledge" as const;
  readonly defaultName = "Knowledge Maintenance Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:1:hour";

  canExecuteHandler(handlerName: string): boolean {
    return handlerName === "system.knowledge_maintenance.run_due";
  }

  getHandlerNames(): string[] {
    return ["system.knowledge_maintenance.run_due"];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const logCtx = { scheduleId: ctx.scheduleId, runId: ctx.runId, taskRunId: ctx.taskRunId, handlerName: ctx.handlerName };
    const result = await knowledgeMaintenanceTool.execute(knowledgeMaintenanceTool.toolNamePrefix, {}, { threadId: "", userId: "" }) as {
      status: string; kind: string; result: unknown;
    };
    log("info", "Knowledge maintenance task completed.", logCtx, result.result as Record<string, unknown>);
    return { outputJson: { kind: "knowledge_maintenance", result: result.result } };
  }

  override getParameterDefinitions(): BatchJobParameterDefinition[] {
    return [
      { key: "pollSeconds", label: "Poll Seconds", type: "number", defaultValue: "60" },
    ];
  }

  protected createDefaultTasks(parameters: Record<string, string>): BatchJobSubTaskTemplate[] {
    return [
      {
        task_key: "knowledge_maintenance",
        name: "Run knowledge maintenance",
        handler_name: "system.knowledge_maintenance.run_due",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
        config_json: { pollSeconds: Number(parameters.pollSeconds || "60") },
      },
    ];
  }
}
