import { v4 as uuid } from "uuid";
import { createLogger } from "@/lib/logging/logger";

const slog = createLogger("scheduler.batch-jobs.base");

export type BatchJobType = "proactive" | "maintenance" | "email" | "job_scout";

export interface BatchJobParameterDefinition {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
  defaultValue?: string;
}

export interface BatchJobSubTaskTemplate {
  task_key: string;
  name: string;
  handler_name: string;
  execution_mode: "sync" | "async" | "fanout";
  sequence_no: number;
  enabled: number;
  depends_on_task_key?: string | null;
  task_type?: "handler" | "prompt";
  prompt?: string;
  config_json?: Record<string, unknown>;
}

export interface BatchJobBuildInput {
  name?: string;
  trigger_type: "cron" | "interval" | "once";
  trigger_expr: string;
  parameters?: Record<string, string>;
  tasks?: BatchJobSubTaskTemplate[];
}

export interface BatchJobBuildResult {
  schedule_key: string;
  name: string;
  handler_type: string;
  trigger_type: "cron" | "interval" | "once";
  trigger_expr: string;
  status: "active" | "paused" | "archived";
  tasks: BatchJobSubTaskTemplate[];
}

export interface StepExecutionContext {
  taskRunId: string;
  runId: string;
  handlerName: string;
  configJson: string | null;
  scheduleId: string;
  pipelineThreadId?: string | null;
}

export interface StepExecutionResult {
  pipelineThreadId?: string;
  /** Structured result data to store in the task run's output_json. */
  outputJson?: Record<string, unknown>;
}

export type LogFn = (
  level: "verbose" | "info" | "warning" | "error",
  message: string,
  context: { scheduleId?: string; runId?: string; taskRunId?: string; handlerName?: string },
  details?: Record<string, unknown>,
) => void;

export abstract class BatchJob {
  abstract readonly type: BatchJobType;
  abstract readonly defaultName: string;
  abstract readonly defaultTriggerType: "cron" | "interval" | "once";
  abstract readonly defaultTriggerExpr: string;

  protected abstract createDefaultTasks(parameters: Record<string, string>): BatchJobSubTaskTemplate[];

  /**
   * Returns true if this batch job class handles the given handler name.
   */
  abstract canExecuteHandler(handlerName: string): boolean;

  /**
   * Returns all handler names this batch job class supports.
   * Used by the scheduler engine for dynamic handler registration.
   */
  abstract getHandlerNames(): string[];

  /**
   * Execute a single step/task for this batch job type.
   * Each subclass owns its own prompts, orchestration, and retry logic.
   *
   * @param ctx  Step execution context (IDs, handler, config, pipeline thread)
   * @param log  Structured logger function provided by the engine
   */
  abstract executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult>;

  getParameterDefinitions(): BatchJobParameterDefinition[] {
    return [];
  }

  build(input: BatchJobBuildInput): BatchJobBuildResult {
    slog.enter("BatchJob.build", { type: this.type, triggerType: input.trigger_type });
    const parameters = input.parameters || {};
    const tasks = input.tasks && input.tasks.length > 0 ? input.tasks : this.createDefaultTasks(parameters);

    const result: BatchJobBuildResult = {
      schedule_key: `batch.${this.type}.${uuid()}`,
      name: input.name?.trim() || `${this.defaultName} ${new Date().toLocaleString()}`,
      handler_type: `batch.${this.type}`,
      trigger_type: input.trigger_type || this.defaultTriggerType,
      trigger_expr: input.trigger_expr?.trim() || this.defaultTriggerExpr,
      status: "active",
      tasks,
    };
    slog.exit("BatchJob.build", { type: this.type, taskCount: tasks.length });
    return result;
  }
}
