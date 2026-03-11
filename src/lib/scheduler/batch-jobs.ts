import { v4 as uuid } from "uuid";

export type BatchJobType = "proactive" | "knowledge" | "cleanup";

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

export abstract class BatchJob {
  abstract readonly type: BatchJobType;
  abstract readonly defaultName: string;
  abstract readonly defaultTriggerType: "cron" | "interval" | "once";
  abstract readonly defaultTriggerExpr: string;
  abstract readonly parameterDefinitions: BatchJobParameterDefinition[];

  protected abstract createDefaultTasks(parameters: Record<string, string>): BatchJobSubTaskTemplate[];

  build(input: BatchJobBuildInput): BatchJobBuildResult {
    const parameters = this.withDefaults(input.parameters || {});
    const tasks = input.tasks && input.tasks.length > 0 ? input.tasks : this.createDefaultTasks(parameters);

    return {
      schedule_key: `batch.${this.type}.${uuid()}`,
      name: input.name?.trim() || `${this.defaultName} ${new Date().toLocaleString()}`,
      handler_type: `batch.${this.type}`,
      trigger_type: input.trigger_type || this.defaultTriggerType,
      trigger_expr: input.trigger_expr?.trim() || this.defaultTriggerExpr,
      status: "active",
      tasks,
    };
  }

  private withDefaults(input: Record<string, string>): Record<string, string> {
    const next: Record<string, string> = { ...input };
    for (const def of this.parameterDefinitions) {
      if (!next[def.key] && def.defaultValue !== undefined) {
        next[def.key] = def.defaultValue;
      }
    }
    return next;
  }
}

class ProactiveBatchJob extends BatchJob {
  readonly type = "proactive" as const;
  readonly defaultName = "Proactive Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:10:minute";
  readonly parameterDefinitions: BatchJobParameterDefinition[] = [
    { key: "severity", label: "Minimum Severity", type: "select", options: ["low", "medium", "high", "disaster"], defaultValue: "high" },
  ];

  protected createDefaultTasks(parameters: Record<string, string>): BatchJobSubTaskTemplate[] {
    return [
      {
        task_key: "scan",
        name: "Run proactive scan",
        handler_name: "system.proactive.scan",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
        config_json: { severity: parameters.severity || "high" },
      },
    ];
  }
}

class KnowledgeBatchJob extends BatchJob {
  readonly type = "knowledge" as const;
  readonly defaultName = "Knowledge Maintenance Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:1:hour";
  readonly parameterDefinitions: BatchJobParameterDefinition[] = [
    { key: "pollSeconds", label: "Poll Seconds", type: "number", defaultValue: "60" },
  ];

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

class CleanupBatchJob extends BatchJob {
  readonly type = "cleanup" as const;
  readonly defaultName = "Log Cleanup Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:1:day";
  readonly parameterDefinitions: BatchJobParameterDefinition[] = [
    { key: "logLevel", label: "Log Level", type: "select", options: ["verbose", "info", "warning", "error"], defaultValue: "warning" },
  ];

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

const REGISTRY: Record<BatchJobType, BatchJob> = {
  proactive: new ProactiveBatchJob(),
  knowledge: new KnowledgeBatchJob(),
  cleanup: new CleanupBatchJob(),
};

export function getBatchJob(type: BatchJobType): BatchJob {
  return REGISTRY[type];
}

export function listBatchJobs(): Array<{ type: BatchJobType; defaultName: string; parameterDefinitions: BatchJobParameterDefinition[]; defaultTriggerType: "cron" | "interval" | "once"; defaultTriggerExpr: string; }> {
  return Object.values(REGISTRY).map((job) => ({
    type: job.type,
    defaultName: job.defaultName,
    parameterDefinitions: job.parameterDefinitions,
    defaultTriggerType: job.defaultTriggerType,
    defaultTriggerExpr: job.defaultTriggerExpr,
  }));
}
