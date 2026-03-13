import {
  addMessage,
  createThread,
  getSchedulerScheduleById,
  getThreadMessages,
} from "@/lib/db";
import {
  BatchJob,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";

/**
 * Built-in system prompts for each Job Scout pipeline step.
 * A shared per-run conversation thread is used so each step can reference
 * the output of the previous one, giving the agent full pipeline context.
 */
const STEP_PROMPTS: Record<string, string> = {
  "workflow.job_scout.search":
    "You are an AI job search specialist. Based on the user's configured job criteria and preferences, " +
    "search for relevant open job listings.\n\n" +
    "IMPORTANT REQUIREMENTS:\n" +
    "1. FIRST, clearly state the search criteria you are using (job title, location, seniority, skills, etc.) " +
    "based on the user's profile and knowledge vault entries.\n" +
    "2. Use SIMPLE, broad search queries first (e.g. 'software engineer jobs Toronto'). Avoid complex site: filters initially.\n" +
    "3. Try at least 3 different job boards/sources: Indeed, Glassdoor, LinkedIn public listings, Google Jobs.\n" +
    "4. For each search query, report: the exact query used and whether results were found.\n" +
    "5. If web_search returns no results, try browser_navigate to visit job board URLs directly.\n" +
    "6. For each listing found, record: position title, company, location, compensation range (if visible), and the application URL.\n" +
    "7. If all searches fail, report every query attempted and suggest criteria adjustments.",
  "workflow.job_scout.extract":
    "You are an AI job research specialist. Review all the job listings found by the search step " +
    "earlier in this conversation thread. The search results are in the messages above.\n\n" +
    "Extract comprehensive role details for each listing: key requirements, technology stack, culture signals, " +
    "compensation benchmarks, and seniority signals. Flag any listings that appear to be a strong match.\n\n" +
    "If no job listings are visible in the conversation above, state clearly that the search step produced no results " +
    "and recommend the pipeline owner verify their search criteria.",
  "workflow.job_scout.prepare":
    "You are an AI resume and cover-letter specialist. Based on all the listings and extracted details " +
    "in this pipeline conversation, prepare tailored application materials for the top-matched " +
    "opportunities. Include specific resume bullet points and a concise cover-letter outline per role.",
  "workflow.job_scout.validate":
    "You are an AI job-application coach. Review all listings, extracted details, and materials " +
    "prepared in this pipeline run. Score each opportunity on fit, growth potential, and compensation. " +
    "Produce a prioritised shortlist with recommended next actions for each.",
  "workflow.job_scout.email":
    "You are an AI communications specialist. Based on all work done in this pipeline run, compose a " +
    "digest summary for the pipeline owner covering: top job matches, key insights, materials prepared, " +
    "and recommended next steps. Send this summary via the available email or messaging tools.",
};

export class JobScoutBatchJob extends BatchJob {
  readonly type = "job_scout" as const;
  readonly defaultName = "Job Scout Pipeline";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:1:day";

  canExecuteHandler(handlerName: string): boolean {
    return handlerName.startsWith("workflow.job_scout.");
  }

  getHandlerNames(): string[] {
    return [
      "workflow.job_scout.search",
      "workflow.job_scout.extract",
      "workflow.job_scout.prepare",
      "workflow.job_scout.validate",
      "workflow.job_scout.email",
    ];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const { taskRunId, runId, handlerName, configJson, scheduleId } = ctx;
    const logCtx = { scheduleId, runId, taskRunId, handlerName };
    const stepKey = handlerName.replace("workflow.job_scout.", "");

    // Step-specific prompt: config can override the built-in default.
    let stepPrompt = STEP_PROMPTS[handlerName] ?? `Execute job scout step: ${stepKey}.`;
    let stepUserId = "";
    let stepThreadId = ctx.pipelineThreadId ?? "";

    try {
      const parsed = JSON.parse(configJson || "{}");
      if (typeof parsed.prompt === "string" && parsed.prompt) stepPrompt = parsed.prompt;
      if (typeof parsed.userId === "string" && parsed.userId) stepUserId = parsed.userId;
    } catch { /* use defaults */ }

    if (!stepUserId) {
      const schedule = getSchedulerScheduleById(scheduleId);
      stepUserId = schedule?.owner_id ?? "";
    }
    if (!stepUserId) {
      throw new Error(`Missing userId for job scout step "${stepKey}". Set schedule owner_id.`);
    }

    // Create a shared pipeline thread on the first step; reuse for subsequent steps.
    if (!stepThreadId) {
      const schedule = getSchedulerScheduleById(scheduleId);
      const title = schedule ? `Job Scout Pipeline: ${schedule.name}` : "Job Scout Pipeline";
      stepThreadId = createThread(title, stepUserId, { threadType: "scheduled" }).id;
      log("info", `Created pipeline thread for job scout run.`, logCtx, { stepKey, threadId: stepThreadId });
    }

    const { runAgentLoop } = await import("@/lib/agent");
    const result = await runAgentLoop(stepThreadId, stepPrompt, undefined, undefined, undefined, stepUserId);

    // Extract tool call details from thread messages for full visibility
    const toolCallDetails = this.extractToolCallDetails(stepThreadId);

    log("info", `Job scout step "${stepKey}" completed.`, logCtx, {
      stepKey,
      threadId: stepThreadId,
      userId: stepUserId,
      toolsUsed: result.toolsUsed ?? [],
      toolCallDetails,
      response: result.content || "",
    });

    // ── Pipeline Orchestrator: validate step output before proceeding ──
    await this.orchestrate(stepKey, stepThreadId, stepUserId, stepPrompt, result.content, logCtx, log);

    return {
      pipelineThreadId: stepThreadId,
      outputJson: {
        kind: "job_scout_pipeline",
        stepKey,
        threadId: stepThreadId,
        userId: stepUserId,
        toolsUsed: result.toolsUsed ?? [],
        toolCallDetails,
        response: result.content || "",
      },
    };
  }

  /**
   * Validate step output and take corrective action:
   * - Search: retry with broader strategy if no results found
   * - Other steps: inject prior context if the step reports missing input
   */
  private async orchestrate(
    stepKey: string,
    threadId: string,
    userId: string,
    stepPrompt: string,
    content: string | undefined,
    logCtx: { scheduleId?: string; runId?: string; taskRunId?: string; handlerName?: string },
    log: LogFn,
  ): Promise<void> {
    const responseText = (content || "").toLowerCase();
    const isEmptyOutput = !content || content.trim().length < 20;
    const indicatesNoResults = responseText.includes("zero results") ||
      responseText.includes("no results") ||
      responseText.includes("no job listings") ||
      responseText.includes("could not find") ||
      responseText.includes("unable to find") ||
      responseText.includes("no matching") ||
      responseText.includes("no opportunities");
    const indicatesMissingInput = responseText.includes("missing") && (
      responseText.includes("input data") ||
      responseText.includes("input") ||
      responseText.includes("information") ||
      responseText.includes("data needed")
    );

    if (stepKey === "search" && (isEmptyOutput || indicatesNoResults)) {
      await this.retrySearch(threadId, userId, content, logCtx, log);
    }

    if (stepKey !== "search" && (isEmptyOutput || indicatesMissingInput)) {
      await this.injectPriorContext(stepKey, threadId, userId, stepPrompt, logCtx, log);
    }
  }

  private async retrySearch(
    threadId: string,
    userId: string,
    originalContent: string | undefined,
    logCtx: { scheduleId?: string; runId?: string; taskRunId?: string; handlerName?: string },
    log: LogFn,
  ): Promise<void> {
    log("warning",
      `Job scout search returned no results. Retrying with broader strategy.`, logCtx, {
        stepKey: "search", originalResponse: (originalContent || "").slice(0, 500),
      });

    const retryPrompt =
      "The previous job search attempt returned zero results from web_search. " +
      "Try a different approach:\n" +
      "1. Use broader, simpler search queries (e.g., just the job title + location, without site: filters).\n" +
      "2. Try multiple job boards: Indeed, Glassdoor, LinkedIn public listings, Google Jobs.\n" +
      "3. Search for the job title alone without location restrictions.\n" +
      "4. Try related/alternative job titles.\n" +
      "5. If web_search still fails, try using browser_navigate to directly visit job board URLs and search there.\n" +
      "Report every query you attempt and the result. If all searches genuinely return nothing, " +
      "state clearly what queries were tried and suggest the user verify their search criteria.";

    const { runAgentLoop } = await import("@/lib/agent");
    const retryResult = await runAgentLoop(threadId, retryPrompt, undefined, undefined, undefined, userId);
    const retryToolCalls = this.extractToolCallDetails(threadId);

    log("info", `Job scout search retry completed.`, logCtx, {
      stepKey: "search_retry",
      threadId,
      toolsUsed: retryResult.toolsUsed ?? [],
      toolCallDetails: retryToolCalls,
      response: retryResult.content || "",
    });
  }

  private async injectPriorContext(
    stepKey: string,
    threadId: string,
    userId: string,
    stepPrompt: string,
    logCtx: { scheduleId?: string; runId?: string; taskRunId?: string; handlerName?: string },
    log: LogFn,
  ): Promise<void> {
    log("warning",
      `Job scout step "${stepKey}" indicates missing input. Injecting prior step context.`, logCtx);

    const threadMsgs = getThreadMessages(threadId);
    const priorOutputs = threadMsgs
      .filter((m) => m.role === "assistant" && m.content)
      .map((m) => m.content!)
      .join("\n---\n");

    if (priorOutputs.trim().length > 50) {
      addMessage({
        thread_id: threadId,
        role: "user",
        content:
          `[Pipeline Orchestrator] Here is the accumulated output from prior pipeline steps. ` +
          `Use this as your input data:\n\n${priorOutputs}`,
        tool_calls: null,
        tool_results: null,
        attachments: null,
      });

      const { runAgentLoop } = await import("@/lib/agent");
      const contextResult = await runAgentLoop(
        threadId,
        `Review the pipeline context provided above and ${stepPrompt}`,
        undefined, undefined, undefined, userId,
      );

      log("info",
        `Job scout step "${stepKey}" re-executed with injected context.`, logCtx, {
          stepKey,
          response: contextResult.content || "",
          toolsUsed: contextResult.toolsUsed ?? [],
        });
    }
  }

  private extractToolCallDetails(threadId: string): Array<{ tool: string; args: Record<string, unknown> }> {
    const threadMsgs = getThreadMessages(threadId);
    const details: Array<{ tool: string; args: Record<string, unknown> }> = [];
    for (const msg of threadMsgs) {
      if (msg.tool_calls) {
        try {
          const calls = JSON.parse(msg.tool_calls);
          for (const tc of Array.isArray(calls) ? calls : [calls]) {
            if (tc?.name && tc?.arguments) {
              details.push({ tool: tc.name, args: tc.arguments });
            }
          }
        } catch { /* skip unparseable */ }
      }
    }
    return details;
  }

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
