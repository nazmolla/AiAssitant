import { v4 as uuid } from "uuid";

export type BatchJobType = "proactive" | "knowledge" | "cleanup" | "email" | "job_scout";

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

  protected abstract createDefaultTasks(parameters: Record<string, string>): BatchJobSubTaskTemplate[];

  getParameterDefinitions(): BatchJobParameterDefinition[] {
    return [];
  }

  build(input: BatchJobBuildInput): BatchJobBuildResult {
    const parameters = input.parameters || {};
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
}

class ProactiveBatchJob extends BatchJob {
  readonly type = "proactive" as const;
  readonly defaultName = "Proactive Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:10:minute";

  protected createDefaultTasks(_parameters: Record<string, string>): BatchJobSubTaskTemplate[] {
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

class KnowledgeBatchJob extends BatchJob {
  readonly type = "knowledge" as const;
  readonly defaultName = "Knowledge Maintenance Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:1:hour";

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

class CleanupBatchJob extends BatchJob {
  readonly type = "cleanup" as const;
  readonly defaultName = "Log Cleanup Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:1:day";

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

class EmailBatchJob extends BatchJob {
  readonly type = "email" as const;
  readonly defaultName = "Email Reading Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:5:minute";

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

class JobScoutBatchJob extends BatchJob {
  readonly type = "job_scout" as const;
  readonly defaultName = "Job Scout Pipeline";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:1:day";

  protected createDefaultTasks(): BatchJobSubTaskTemplate[] {
    return [
      {
        task_key: "search",
        name: "Search Listings",
        handler_name: "workflow.job_scout.search",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
        task_type: "prompt",
        prompt: "Search for job listings matching the user's profile and preferences. Focus on roles that align with their experience and goals.",
      },
      {
        task_key: "extract",
        name: "Extract Role Details",
        handler_name: "workflow.job_scout.extract",
        execution_mode: "sync",
        sequence_no: 1,
        enabled: 1,
        depends_on_task_key: "search",
        task_type: "prompt",
        prompt: "Extract detailed role information including responsibilities, requirements, and key qualifications from the listings found.",
      },
      {
        task_key: "prepare",
        name: "Prepare Resume",
        handler_name: "workflow.job_scout.prepare",
        execution_mode: "sync",
        sequence_no: 2,
        enabled: 1,
        depends_on_task_key: "extract",
        task_type: "prompt",
        prompt: "Generate a tailored resume that highlights relevant skills and experience for the identified roles.",
      },
      {
        task_key: "validate",
        name: "Validate Matches",
        handler_name: "workflow.job_scout.validate",
        execution_mode: "sync",
        sequence_no: 3,
        enabled: 1,
        depends_on_task_key: "prepare",
        task_type: "prompt",
        prompt: "Validate that all identified job matches are relevant and meet the user's criteria.",
      },
      {
        task_key: "email",
        name: "Send Results",
        handler_name: "workflow.job_scout.email",
        execution_mode: "sync",
        sequence_no: 4,
        enabled: 1,
        depends_on_task_key: "validate",
        task_type: "prompt",
        prompt: "Prepare and send a summary email with the curated job matches and tailored resume to the user.",
      },
    ];
  }
}

const REGISTRY: Record<BatchJobType, BatchJob> = {
  proactive: new ProactiveBatchJob(),
  knowledge: new KnowledgeBatchJob(),
  cleanup: new CleanupBatchJob(),
  email: new EmailBatchJob(),
  job_scout: new JobScoutBatchJob(),
};

export function getBatchJob(type: BatchJobType): BatchJob {
  return REGISTRY[type];
}

export function listBatchJobs(): Array<{ type: BatchJobType; defaultName: string; parameterDefinitions: BatchJobParameterDefinition[]; defaultTriggerType: "cron" | "interval" | "once"; defaultTriggerExpr: string; }> {
  return Object.values(REGISTRY).map((job) => ({
    type: job.type,
    defaultName: job.defaultName,
    parameterDefinitions: job.getParameterDefinitions(),
    defaultTriggerType: job.defaultTriggerType,
    defaultTriggerExpr: job.defaultTriggerExpr,
  }));
}
