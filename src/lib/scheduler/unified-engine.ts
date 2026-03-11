import {
  addLog,
  addSchedulerEvent,
  createSchedulerRun,
  createThread,
  createSchedulerTaskRun,
  getSchedulerScheduleById,
  getSchedulerTasksForSchedule,
  getSchedulerTaskRunsForRun,
  heartbeatSchedulerClaim,
  listDueSchedulerSchedules,
  listRunnableSchedulerRuns,
  releaseSchedulerClaim,
  setSchedulerTaskRunLogRef,
  setSchedulerRunStatus,
  setSchedulerTaskRunStatus,
  tryClaimSchedulerRun,
  updateSchedulerScheduleAfterDispatch,
  type SchedulerScheduleRecord,
  runDbMaintenanceIfDue,
  listEnabledSchedulerTaskHandlers,
} from "@/lib/db";
import { runEmailReadBatch, runProactiveScan } from "@/lib/scheduler";
import { runKnowledgeMaintenanceIfDue } from "@/lib/knowledge-maintenance";
import { computeSchedulerNextRunAt } from "@/lib/scheduler/next-run";

interface SchedulerLogContext {
  scheduleId?: string;
  runId?: string;
  taskRunId?: string;
  handlerName?: string;
}

const ENGINE_POLL_MS = 10_000;
const CLAIM_LEASE_SECONDS = 60;
const WORKER_ID = `scheduler-worker-${process.pid}`;

let _engineTimer: ReturnType<typeof setInterval> | null = null;
let _engineTickRunning = false;

const REGISTERED_SCHEDULER_HANDLERS = new Set<string>([
  "agent.prompt",
  "system.proactive.scan",
  "system.email.read_incoming",
  "system.db_maintenance.run_due",
  "system.knowledge_maintenance.run_due",
  "workflow.job_scout.search",
  "workflow.job_scout.extract",
  "workflow.job_scout.prepare",
  "workflow.job_scout.validate",
  "workflow.job_scout.email",
]);

/**
 * Built-in system prompts for each Job Scout pipeline step.
 * A shared per-run conversation thread is used so each step can reference
 * the output of the previous one, giving the agent full pipeline context.
 */
const JOB_SCOUT_STEP_PROMPTS: Record<string, string> = {
  "workflow.job_scout.search":
    "You are an AI job search specialist. Based on the user's configured job criteria and preferences, " +
    "search for relevant open job listings. For each listing record: position title, company, location, " +
    "compensation range (if visible), and the application URL.",
  "workflow.job_scout.extract":
    "You are an AI job research specialist. Review all the job listings found in this pipeline run and " +
    "extract comprehensive role details: key requirements, technology stack, culture signals, " +
    "compensation benchmarks, and seniority signals. Flag any listings that appear to be a strong match.",
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

function validateRegisteredHandlers(): void {
  const handlers = listEnabledSchedulerTaskHandlers();
  const unknown = handlers.filter((h) => !REGISTERED_SCHEDULER_HANDLERS.has(h.handler_name));
  if (unknown.length === 0) return;

  addLog({
    level: "error",
    source: "scheduler-engine",
    message: "Found enabled scheduler tasks with unregistered handlers.",
    metadata: JSON.stringify({ unknown }),
  });
}

function dispatchDueSchedules(): void {
  const due = listDueSchedulerSchedules(25);
  if (due.length === 0) return;

  for (const schedule of due) {
    const run = createSchedulerRun(schedule.id, "timer");
    const tasks = getSchedulerTasksForSchedule(schedule.id);
    for (const task of tasks) {
      createSchedulerTaskRun(run.id, task.id);
    }

    updateSchedulerScheduleAfterDispatch(
      schedule.id,
      computeSchedulerNextRunAt(schedule.trigger_type as "cron" | "interval" | "once", schedule.trigger_expr),
    );
    addSchedulerEvent(run.id, "run_dispatched", `Dispatched ${tasks.length} task(s)`, null, JSON.stringify({ scheduleId: schedule.id }));

    addLog({
      level: "info",
      source: "scheduler-engine",
      message: `Dispatched run ${run.id.slice(0, 8)} for schedule \"${schedule.name}\" with ${tasks.length} task(s).`,
      metadata: JSON.stringify({ scheduleId: schedule.id, runId: run.id, tasks: tasks.length, correlationId: run.correlation_id }),
    });
  }
}

function serializeLogRef(context: SchedulerLogContext): string {
  const parts = [
    context.scheduleId ? `scheduleId=${encodeURIComponent(context.scheduleId)}` : "",
    context.runId ? `runId=${encodeURIComponent(context.runId)}` : "",
    context.taskRunId ? `taskRunId=${encodeURIComponent(context.taskRunId)}` : "",
    context.handlerName ? `handlerName=${encodeURIComponent(context.handlerName)}` : "",
  ].filter(Boolean);
  return parts.join("&");
}

function logSchedulerExecution(level: "verbose" | "info" | "warning" | "error", message: string, context: SchedulerLogContext, details?: Record<string, unknown>): void {
  addLog({
    level,
    source: "scheduler-engine",
    message,
    metadata: JSON.stringify({
      scheduleId: context.scheduleId || null,
      runId: context.runId || null,
      taskRunId: context.taskRunId || null,
      handlerName: context.handlerName || null,
      ...(details || {}),
    }),
  });
}

async function executeTaskRun(
  taskRunId: string,
  runId: string,
  handlerName: string,
  configJson: string | null,
  scheduleId: string,
  pipelineThreadId?: string | null,
): Promise<{ pipelineThreadId?: string }> {
  const context: SchedulerLogContext = { scheduleId, runId, taskRunId, handlerName };
  setSchedulerTaskRunLogRef(taskRunId, serializeLogRef(context));
  logSchedulerExecution("info", "Starting scheduler task-run execution.", context);
  setSchedulerTaskRunStatus(taskRunId, "running");

  try {
    if (handlerName === "agent.prompt") {
      let prompt = "";
      let threadId = "";
      let userId = "";
      try {
        const parsed = JSON.parse(configJson || "{}");
        prompt = typeof parsed.prompt === "string" ? parsed.prompt : "";
        threadId = typeof parsed.threadId === "string" ? parsed.threadId : "";
        userId = typeof parsed.userId === "string" ? parsed.userId : "";
      } catch {
        prompt = "";
      }
      if (!prompt) {
        throw new Error("Missing prompt in scheduler task config for agent.prompt handler.");
      }

      if (!userId) {
        const schedule = getSchedulerScheduleById(scheduleId);
        userId = schedule?.owner_id || "";
      }
      if (!userId) {
        throw new Error("Missing userId for scheduler agent prompt task. Set schedule owner or task config userId.");
      }

      if (!threadId) {
        const schedule = getSchedulerScheduleById(scheduleId);
        const title = schedule ? `Batch Job: ${schedule.name}` : "Batch Job";
        threadId = createThread(title, userId).id;
      }
      const { runAgentLoop } = await import("@/lib/agent");
      const result = await runAgentLoop(threadId, prompt, undefined, undefined, undefined, userId);
      logSchedulerExecution("info", "Scheduler prompt task completed successfully.", context, {
        threadId,
        userId,
        toolsUsed: result.toolsUsed ?? 0,
        responsePreview: (result.content || "").slice(0, 400),
      });
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "agent_prompt", threadId, userId, toolsUsed: result.toolsUsed ?? 0 }));
      return {};
    }

    if (handlerName === "system.proactive.scan") {
      await runProactiveScan({ scheduleId, runId, taskRunId, handlerName });
      logSchedulerExecution("info", "Proactive scan task completed successfully.", context);
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "proactive_scan" }));
      return {};
    }

    if (handlerName === "system.email.read_incoming") {
      await runEmailReadBatch({ scheduleId, runId, taskRunId, handlerName });
      logSchedulerExecution("info", "Email read task completed successfully.", context);
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "email_read_incoming" }));
      return {};
    }

    if (handlerName === "system.db_maintenance.run_due") {
      const result = runDbMaintenanceIfDue();
      logSchedulerExecution("info", "DB maintenance task completed.", context, {
        maintenanceSkipped: result === null,
        ...(result || {}),
      });
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "db_maintenance", result }));
      return {};
    }

    if (handlerName === "system.knowledge_maintenance.run_due") {
      const result = runKnowledgeMaintenanceIfDue();
      logSchedulerExecution("info", "Knowledge maintenance task completed.", context, result as unknown as Record<string, unknown>);
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "knowledge_maintenance", result }));
      return {};
    }

    if (handlerName.startsWith("workflow.job_scout.")) {
      const stepKey = handlerName.replace("workflow.job_scout.", "");

      // Step-specific prompt: config can override the built-in default.
      let stepPrompt = JOB_SCOUT_STEP_PROMPTS[handlerName] ?? `Execute job scout step: ${stepKey}.`;
      let stepUserId = "";
      let stepThreadId = pipelineThreadId ?? "";

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

      // Create a shared pipeline thread on the first step; reuse it for all subsequent steps
      // so each step runs in the same conversation and can reference prior step output.
      if (!stepThreadId) {
        const schedule = getSchedulerScheduleById(scheduleId);
        const title = schedule ? `Job Scout Pipeline: ${schedule.name}` : "Job Scout Pipeline";
        stepThreadId = createThread(title, stepUserId).id;
        logSchedulerExecution("info", `Created pipeline thread for job scout run.`, context, { stepKey, threadId: stepThreadId });
      }

      const { runAgentLoop } = await import("@/lib/agent");
      const result = await runAgentLoop(stepThreadId, stepPrompt, undefined, undefined, undefined, stepUserId);

      logSchedulerExecution("info", `Job scout step "${stepKey}" completed.`, context, {
        stepKey,
        threadId: stepThreadId,
        userId: stepUserId,
        toolsUsed: result.toolsUsed ?? 0,
        responsePreview: (result.content || "").slice(0, 400),
      });
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({
        kind: "job_scout_pipeline",
        stepKey,
        threadId: stepThreadId,
        userId: stepUserId,
        toolsUsed: result.toolsUsed ?? 0,
      }));
      return { pipelineThreadId: stepThreadId };
    }

    throw new Error(`Unsupported scheduler handler: ${handlerName}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logSchedulerExecution("error", "Scheduler task-run failed.", context, { error: message });
    setSchedulerTaskRunStatus(taskRunId, "failed", null, message);
    throw err;
  }
}

async function executeRunnableRun(): Promise<void> {
  const candidates = listRunnableSchedulerRuns(10);
  const claimed = candidates.find((run) => tryClaimSchedulerRun(run.id, WORKER_ID, CLAIM_LEASE_SECONDS));
  if (!claimed) return;

  try {
    setSchedulerRunStatus(claimed.id, "running");
    logSchedulerExecution("info", "Scheduler run claimed and started.", { scheduleId: claimed.schedule_id, runId: claimed.id }, {
      triggerSource: claimed.trigger_source,
    });
    addSchedulerEvent(claimed.id, "run_started", "Scheduler run execution started");

    const taskRuns = getSchedulerTaskRunsForRun(claimed.id);

    // Mutable status map updated after each task so dependency checks always see
    // the real outcome of tasks that have already executed in this run.
    // Bug fix: loading once at the start and never updating caused every task with
    // a dependency to see "pending" (the initial DB state) and always skip.
    const taskRunStatusById = new Map<string, string>(
      taskRuns.map((tr) => [tr.schedule_task_id, tr.status as string])
    );

    // Load all task definitions once — avoids a DB round-trip per iteration.
    const allTasks = getSchedulerTasksForSchedule(claimed.schedule_id);

    let failures = 0;
    // Shared pipeline thread — created by the first job scout step and reused by all.
    let pipelineThreadId: string | null = null;

    for (const taskRun of taskRuns) {
      const runCtx: SchedulerLogContext = { scheduleId: claimed.schedule_id, runId: claimed.id, taskRunId: taskRun.id };

      if (taskRun.status !== "pending" && taskRun.status !== "retrying") {
        logSchedulerExecution("info",
          `Task-run ${taskRun.id.slice(0, 8)} already in terminal state "${taskRun.status}", skipping.`, runCtx);
        addSchedulerEvent(claimed.id, "task_skipped",
          `Skipped task-run ${taskRun.id} — already in terminal state ${taskRun.status}`, taskRun.id);
        continue;
      }

      heartbeatSchedulerClaim(claimed.id, WORKER_ID, CLAIM_LEASE_SECONDS);

      const task = allTasks.find((t) => t.id === taskRun.schedule_task_id);
      if (!task) {
        failures += 1;
        setSchedulerTaskRunStatus(taskRun.id, "failed", null, "Scheduler task definition missing.");
        taskRunStatusById.set(taskRun.schedule_task_id, "failed");
        logSchedulerExecution("error", `Task definition missing for task-run ${taskRun.id.slice(0, 8)}.`, runCtx);
        continue;
      }

      const taskCtx: SchedulerLogContext = { ...runCtx, handlerName: task.handler_name };

      if (task.depends_on_task_id) {
        const depStatus = taskRunStatusById.get(task.depends_on_task_id) ?? "not_found";
        if (depStatus !== "success") {
          const reason =
            `Dependency task (id=${task.depends_on_task_id.slice(0, 8)}) has status "${depStatus}" — expected "success".`;
          setSchedulerTaskRunStatus(taskRun.id, "skipped", null, reason);
          taskRunStatusById.set(taskRun.schedule_task_id, "skipped");
          logSchedulerExecution("warning",
            `Skipping task "${task.task_key}" (handler=${task.handler_name}): ${reason}`, taskCtx);
          addSchedulerEvent(claimed.id, "task_skipped",
            `Skipped "${task.name}" (${task.task_key}): dependency ${task.depends_on_task_id.slice(0, 8)} is "${depStatus}"`,
            taskRun.id);
          continue;
        }
      }

      logSchedulerExecution("info",
        `Executing task "${task.name}" (${task.task_key}) — handler=${task.handler_name}.`, taskCtx);
      addSchedulerEvent(claimed.id, "task_started", `Starting "${task.name}" (${task.task_key})`, taskRun.id);

      try {
        const result = await executeTaskRun(
          taskRun.id, claimed.id, task.handler_name, task.config_json, claimed.schedule_id, pipelineThreadId
        );
        if (result.pipelineThreadId) pipelineThreadId = result.pipelineThreadId;
        // Update in-memory map so subsequent dependency checks see the real outcome.
        taskRunStatusById.set(taskRun.schedule_task_id, "success");
        addSchedulerEvent(claimed.id, "task_completed", `Completed "${task.name}" (${task.task_key})`, taskRun.id);
      } catch (err) {
        failures += 1;
        // Update in-memory map so dependent tasks are correctly skipped.
        taskRunStatusById.set(taskRun.schedule_task_id, "failed");
        const errMsg = err instanceof Error ? err.message : String(err);
        logSchedulerExecution("error",
          `Task "${task.name}" (${task.task_key}) failed: ${errMsg}`, taskCtx);
        addSchedulerEvent(claimed.id, "task_failed",
          `Failed "${task.name}" (${task.task_key}): ${errMsg}`, taskRun.id);
        // Continue processing remaining independent tasks for partial-success visibility.
      }
    }

    const finalStatus = failures === 0 ? "success" : failures < taskRuns.length ? "partial_success" : "failed";
    setSchedulerRunStatus(claimed.id, finalStatus);
    logSchedulerExecution("info", "Scheduler run completed.", { scheduleId: claimed.schedule_id, runId: claimed.id }, {
      finalStatus,
      failures,
      taskCount: taskRuns.length,
    });
    addSchedulerEvent(claimed.id, "run_finished", `Run completed with status ${finalStatus}`, null, JSON.stringify({ failures, taskCount: taskRuns.length }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSchedulerRunStatus(claimed.id, "failed", message);
    logSchedulerExecution("error", "Scheduler run failed.", { scheduleId: claimed.schedule_id, runId: claimed.id }, { error: message });
    addSchedulerEvent(claimed.id, "run_failed", message);
  } finally {
    releaseSchedulerClaim(claimed.id);
  }
}

async function engineTick(): Promise<void> {
  if (_engineTickRunning) return;
  _engineTickRunning = true;
  try {
    dispatchDueSchedules();
    await executeRunnableRun();
  } finally {
    _engineTickRunning = false;
  }
}

export async function runUnifiedSchedulerEngineTickForTests(): Promise<void> {
  await engineTick();
}

export function startUnifiedSchedulerEngine(): void {
  if (_engineTimer) return;

  validateRegisteredHandlers();

  _engineTimer = setInterval(() => {
    engineTick().catch((err) => {
      addLog({
        level: "error",
        source: "scheduler-engine",
        message: `Unified scheduler engine tick failed: ${err}`,
        metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err), workerId: WORKER_ID }),
      });
    });
  }, ENGINE_POLL_MS);

  addLog({
    level: "info",
    source: "scheduler-engine",
    message: "Unified scheduler engine started.",
    metadata: JSON.stringify({ pollMs: ENGINE_POLL_MS, workerId: WORKER_ID }),
  });
}

export function stopUnifiedSchedulerEngine(): void {
  if (!_engineTimer) return;
  clearInterval(_engineTimer);
  _engineTimer = null;
  addLog({
    level: "info",
    source: "scheduler-engine",
    message: "Unified scheduler engine stopped.",
    metadata: JSON.stringify({ workerId: WORKER_ID }),
  });
}
