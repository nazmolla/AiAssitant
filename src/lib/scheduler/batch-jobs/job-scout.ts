import {
  createThread,
  getSchedulerScheduleById,
} from "@/lib/db";
import { retrieveKnowledge } from "@/lib/knowledge/retriever";
import {
  BatchJob,
  type BatchJobParameterDefinition,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";
import { JOB_SCOUT_TASK_PROMPT } from "@/lib/prompts";

export class JobScoutBatchJob extends BatchJob {
  readonly type = "job_scout" as const;
  readonly defaultName = "Job Scout Pipeline";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:1:day";

  canExecuteHandler(handlerName: string): boolean {
    return handlerName === "workflow.job_scout.run";
  }

  getHandlerNames(): string[] {
    return ["workflow.job_scout.run"];
  }

  override getParameterDefinitions(): BatchJobParameterDefinition[] {
    return [
      {
        key: "maxIterations",
        label: "Max Iterations",
        type: "select",
        options: ["5", "10", "15", "25", "40"],
        defaultValue: "25",
      },
    ];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const { taskRunId, runId, handlerName, configJson, scheduleId } = ctx;
    const logCtx = { scheduleId, runId, taskRunId, handlerName };

    let userId = "";
    let additionalContext = "";
    let maxIterations: number | undefined;
    const threadId = ctx.pipelineThreadId ?? "";

    try {
      const parsed = JSON.parse(configJson || "{}");
      if (typeof parsed.prompt === "string" && parsed.prompt) additionalContext = parsed.prompt;
      if (typeof parsed.userId === "string" && parsed.userId) userId = parsed.userId;
      if (typeof parsed.maxIterations === "number" && parsed.maxIterations > 0) maxIterations = parsed.maxIterations;
    } catch { /* use defaults */ }

    if (!userId) {
      const schedule = getSchedulerScheduleById(scheduleId);
      userId = schedule?.owner_id ?? "";
    }
    if (!userId) {
      throw new Error("Missing userId for job scout. Set schedule owner_id.");
    }

    let runThreadId = threadId;
    if (!runThreadId) {
      const schedule = getSchedulerScheduleById(scheduleId);
      const title = schedule ? `Job Scout: ${schedule.name}` : "Job Scout";
      runThreadId = createThread(title, userId, { threadType: "scheduled" }).id;
      log("info", "Created pipeline thread for job scout run.", logCtx, { threadId: runThreadId });
    }

    // Pre-fetch career knowledge so it is guaranteed to be available in context.
    // Retrieve across multiple career-relevant queries and merge unique entries.
    const careerQueries = ["career", "skills", "experience", "role", "resume", "education", "location", "salary", "contact", "achievements"];
    const knowledgeMap = new Map<number, { entity: string; attribute: string; value: string }>();
    for (const q of careerQueries) {
      const entries = await retrieveKnowledge(q, 20, userId);
      for (const e of entries) {
        if (!knowledgeMap.has(e.id)) knowledgeMap.set(e.id, { entity: e.entity, attribute: e.attribute, value: e.value });
      }
    }
    const careerKnowledge = Array.from(knowledgeMap.values());

    let knowledgeContext = "";
    if (careerKnowledge.length > 0) {
      knowledgeContext = "\n\n## Pre-loaded career profile from knowledge vault\nUse this data to score jobs and generate resumes. Do NOT fabricate any information not present here.\n" +
        careerKnowledge.map((k) => `- ${k.entity} / ${k.attribute}: ${k.value}`).join("\n");
      log("info", `Injected ${careerKnowledge.length} career knowledge entries into job scout context.`, logCtx);
    } else {
      log("warning", "No career knowledge found for user — job scout may abort.", logCtx);
    }

    // Build the single user message: career knowledge + task prompt.
    // Run directly via runAgentLoop so the LLM executes all steps itself without
    // decomposition — OrchestratorAgent would delegate to sub-agents that don't
    // reliably forward the career profile when formulating search queries.
    const parts = [additionalContext, knowledgeContext].filter(Boolean);
    const userMessage = parts.length > 0
      ? `${parts.join("\n\n")}\n\n${JOB_SCOUT_TASK_PROMPT}`
      : JOB_SCOUT_TASK_PROMPT;

    const { runAgentLoop } = await import("@/lib/agent");
    const result = await runAgentLoop(
      runThreadId,
      userMessage,
      undefined,
      undefined,
      false,
      userId,
      undefined,
      undefined,
      undefined,
      undefined,
      maxIterations,
    );

    log("info", "Job scout run completed.", logCtx, {
      threadId: runThreadId,
      toolsUsed: result.toolsUsed,
      response: result.content.slice(0, 500),
    });

    return {
      pipelineThreadId: runThreadId,
      outputJson: {
        kind: "job_scout_direct",
        threadId: runThreadId,
        userId,
        toolsUsed: result.toolsUsed,
        response: result.content,
      },
    };
  }

  protected createDefaultTasks(parameters: Record<string, string> = {}): BatchJobSubTaskTemplate[] {
    const maxIterations = parameters.maxIterations ? Number(parameters.maxIterations) : 25;
    return [
      {
        task_key: "run",
        name: "Job Scout",
        handler_name: "workflow.job_scout.run",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
        config_json: { maxIterations },
        task_type: "orchestrator.call",
        agent_name: "job-scout",
        input_schema: {
          type: "object",
          properties: {
            maxIterations: { type: "number" },
            userId: { type: "string" },
          },
          required: [],
        },
        output_schema: {
          type: "object",
          properties: {
            jobsFound: { type: "number" },
            jobsApplied: { type: "number" },
            threadId: { type: "string" },
          },
          required: ["jobsFound", "jobsApplied", "threadId"],
        },
        input_values: { maxIterations },
      },
    ];
  }
}
