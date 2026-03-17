import {
  createThread,
  getSchedulerScheduleById,
} from "@/lib/db";
import {
  BatchJob,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";
import { OrchestratorAgent, AgentRegistry } from "@/lib/agent/multi-agent";

/* ── Job Scout task description for the orchestrator ───────────── */

const JOB_SCOUT_TASK =
  "Scout for job opportunities matching the user's profile and career preferences.\n\n" +
  "Steps to complete:\n" +
  "1. Research: Find current job listings matching the user's skills, role preferences, and location. " +
  "Use web_researcher to search multiple job boards (Indeed, LinkedIn, Glassdoor, Google Jobs).\n" +
  "2. Analyse: Extract details from the best matches — requirements, compensation, culture fit.\n" +
  "3. Prepare: Draft tailored application materials (resume bullets, cover letter outline) for top matches. " +
  "Use resume_writer.\n" +
  "4. Validate: Score and shortlist opportunities by fit and potential.\n" +
  "5. Notify: Compose and send a digest summary of top matches via email_manager.";

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

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const { taskRunId, runId, handlerName, configJson, scheduleId } = ctx;
    const logCtx = { scheduleId, runId, taskRunId, handlerName };

    let userId = "";
    let additionalContext = "";
    const threadId = ctx.pipelineThreadId ?? "";

    try {
      const parsed = JSON.parse(configJson || "{}");
      if (typeof parsed.prompt === "string" && parsed.prompt) additionalContext = parsed.prompt;
      if (typeof parsed.userId === "string" && parsed.userId) userId = parsed.userId;
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

    const registry = AgentRegistry.getInstance();
    const orchestrator = new OrchestratorAgent(registry);
    const result = await orchestrator.run(
      additionalContext ? `${JOB_SCOUT_TASK}\n\n## User context\n${additionalContext}` : JOB_SCOUT_TASK,
      { userId, threadId: runThreadId },
    );

    log("info", "Job scout orchestration completed.", logCtx, {
      threadId: result.threadId,
      agentsDispatched: result.agentsDispatched,
      toolsUsed: result.toolsUsed,
      response: result.response.slice(0, 500),
    });

    return {
      pipelineThreadId: result.threadId,
      outputJson: {
        kind: "job_scout_orchestrated",
        threadId: result.threadId,
        userId,
        agentsDispatched: result.agentsDispatched,
        toolsUsed: result.toolsUsed,
        response: result.response,
      },
    };
  }

  protected createDefaultTasks(): BatchJobSubTaskTemplate[] {
    return [
      {
        task_key: "run",
        name: "Job Scout",
        handler_name: "workflow.job_scout.run",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
      },
    ];
  }
}
