export {
  BatchJob,
  type BatchJobType,
  type BatchJobParameterDefinition,
  type BatchJobSubTaskTemplate,
  type BatchJobBuildInput,
  type BatchJobBuildResult,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";

import type { BatchJob, BatchJobType, BatchJobParameterDefinition } from "./base";
import { ProactiveBatchJob } from "./proactive";
import { KnowledgeBatchJob } from "./knowledge";
import { CleanupBatchJob } from "./cleanup";
import { EmailBatchJob } from "./email";
import { JobScoutBatchJob } from "./job-scout";

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

/**
 * Find the batch job class that can execute the given handler name.
 * Returns undefined for generic handlers like agent.prompt that
 * are handled directly by the engine.
 */
export function findBatchJobForHandler(handlerName: string): BatchJob | undefined {
  return Object.values(REGISTRY).find((job) => job.canExecuteHandler(handlerName));
}

export function listBatchJobs(): Array<{
  type: BatchJobType;
  defaultName: string;
  parameterDefinitions: BatchJobParameterDefinition[];
  defaultTriggerType: "cron" | "interval" | "once";
  defaultTriggerExpr: string;
}> {
  return Object.values(REGISTRY).map((job) => ({
    type: job.type,
    defaultName: job.defaultName,
    parameterDefinitions: job.getParameterDefinitions(),
    defaultTriggerType: job.defaultTriggerType,
    defaultTriggerExpr: job.defaultTriggerExpr,
  }));
}

/**
 * Collect all handler names from every registered batch job.
 * Used by the scheduler engine for dynamic handler validation.
 */
export function getAllHandlerNames(): string[] {
  return Object.values(REGISTRY).flatMap((job) => job.getHandlerNames());
}
