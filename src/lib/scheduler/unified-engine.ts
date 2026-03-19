import { addLog } from "@/lib/db/log-queries";
import { createThread } from "@/lib/db/thread-queries";
import {
  addSchedulerEvent,
  createSchedulerRun,
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
  listEnabledSchedulerTaskHandlers,
} from "@/lib/db/scheduler-queries";
import {
  SCHEDULER_POLL_MS,
  SCHEDULER_LEASE_SECONDS,
  SCHEDULER_BATCH_SIZE,
  SCHEDULER_RESPONSE_PREVIEW_CHARS,
} from "@/lib/constants";
import { computeSchedulerNextRunAt } from "@/lib/scheduler/next-run";
import { findBatchJobForHandler } from "@/lib/scheduler/batch-jobs";
import { getAllHandlerNames } from "@/lib/scheduler/batch-jobs";

interface SchedulerLogContext {
  scheduleId?: string;
  runId?: string;
  taskRunId?: string;
  handlerName?: string;
}

/* ── Handler registry ─────────────────────────────────────────────── */

const handlerRegistry = new Set<string>();

interface SchedulerEngineDependencies {
  listEnabledSchedulerTaskHandlers: typeof listEnabledSchedulerTaskHandlers;
  getAllHandlerNames: typeof getAllHandlerNames;
  addLog: typeof addLog;
}

const defaultSchedulerEngineDependencies: SchedulerEngineDependencies = {
  listEnabledSchedulerTaskHandlers,
  getAllHandlerNames,
  addLog,
};

let schedulerEngineDependencies: SchedulerEngineDependencies = defaultSchedulerEngineDependencies;

export function configureSchedulerEngineDependencies(overrides: Partial<SchedulerEngineDependencies>): void {
  schedulerEngineDependencies = {
    ...schedulerEngineDependencies,
    ...overrides,
  };
}

/**
 * Register a scheduler handler name.
 * Called automatically with batch-job handlers on engine start,
 * and can be called externally for ad-hoc handlers.
 */
export function registerHandler(name: string): void {
  handlerRegistry.add(name);
}

export function getRegisteredHandlers(): ReadonlySet<string> {
  return handlerRegistry;
}

function populateHandlerRegistry(): void {
  // Built-in generic handler
  registerHandler("agent.prompt");
  // Batch-job handlers discovered dynamically
  for (const name of schedulerEngineDependencies.getAllHandlerNames()) {
    registerHandler(name);
  }
}

export interface SchedulerEngineConfig {
  pollMs?: number;
  leaseSeconds?: number;
}

/* ── Engine state (encapsulated) ──────────────────────────────────── */

const engineState = {
  timer: null as ReturnType<typeof setInterval> | null,
  tickRunning: false,
  pollMs: SCHEDULER_POLL_MS,
  leaseSeconds: SCHEDULER_LEASE_SECONDS,
};

/** Reset engine state and handler registry (for testing). */
export function resetSchedulerEngine(): void {
  if (engineState.timer) {
    clearInterval(engineState.timer);
  }
  engineState.timer = null;
  engineState.tickRunning = false;
  engineState.pollMs = SCHEDULER_POLL_MS;
  engineState.leaseSeconds = SCHEDULER_LEASE_SECONDS;
  handlerRegistry.clear();
  schedulerEngineDependencies = defaultSchedulerEngineDependencies;
}

const WORKER_ID = `scheduler-worker-${process.pid}`;

function validateRegisteredHandlers(): void {
  const handlers = schedulerEngineDependencies.listEnabledSchedulerTaskHandlers();
  const unknown = handlers.filter((h) => !handlerRegistry.has(h.handler_name));
  if (unknown.length === 0) return;

  schedulerEngineDependencies.addLog({
    level: "error",
    source: "scheduler-engine",
    message: "Found enabled scheduler tasks with unregistered handlers.",
    metadata: JSON.stringify({ unknown }),
  });
}

function dispatchDueSchedules(): void {
  const due = listDueSchedulerSchedules(SCHEDULER_BATCH_SIZE);
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

    schedulerEngineDependencies.addLog({
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
  schedulerEngineDependencies.addLog({
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
    // ── Generic agent.prompt handler (used by any batch type) ──
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
        threadId = createThread(title, userId, { threadType: "scheduled" }).id;
      }
      const { runAgentLoop } = await import("@/lib/agent");
      const result = await runAgentLoop(threadId, prompt, undefined, undefined, undefined, userId);
      logSchedulerExecution("info", "Scheduler prompt task completed successfully.", context, {
        threadId,
        userId,
        toolsUsed: result.toolsUsed ?? [],
        responsePreview: (result.content || "").slice(0, SCHEDULER_RESPONSE_PREVIEW_CHARS),
      });
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({
        kind: "agent_prompt", threadId, userId,
        toolsUsed: result.toolsUsed ?? [],
        response: result.content || "",
      }));
      return {};
    }

    // ── Delegate to the batch job class that owns this handler ──
    const batchJob = findBatchJobForHandler(handlerName);
    if (batchJob) {
      const stepResult = await batchJob.executeStep(
        { taskRunId, runId, handlerName, configJson, scheduleId, pipelineThreadId },
        logSchedulerExecution,
      );
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify(
        stepResult.outputJson ?? { kind: batchJob.type, handlerName },
      ));
      return { pipelineThreadId: stepResult.pipelineThreadId };
    }

    throw new Error(`Unsupported scheduler handler: ${handlerName}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logSchedulerExecution("error", "Scheduler task-run failed.", context, {
      error: message,
      stack,
      handlerName,
      configJson: configJson ?? undefined,
    });
    setSchedulerTaskRunStatus(taskRunId, "failed", null, message);
    throw err;
  }
}

async function executeRunnableRun(): Promise<void> {
  const candidates = listRunnableSchedulerRuns(10);
  const claimed = candidates.find((run) => tryClaimSchedulerRun(run.id, WORKER_ID, engineState.leaseSeconds));
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

      heartbeatSchedulerClaim(claimed.id, WORKER_ID, engineState.leaseSeconds);

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
        const errStack = err instanceof Error ? err.stack : undefined;
        logSchedulerExecution("error",
          `Task "${task.name}" (${task.task_key}) failed: ${errMsg}`, taskCtx,
          { stack: errStack, configJson: task.config_json ?? undefined });
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
    const stack = err instanceof Error ? err.stack : undefined;
    setSchedulerRunStatus(claimed.id, "failed", message);
    logSchedulerExecution("error", "Scheduler run failed.", { scheduleId: claimed.schedule_id, runId: claimed.id }, { error: message, stack });
    addSchedulerEvent(claimed.id, "run_failed", message);
  } finally {
    releaseSchedulerClaim(claimed.id);
  }
}

async function engineTick(): Promise<void> {
  if (engineState.tickRunning) return;
  engineState.tickRunning = true;
  try {
    dispatchDueSchedules();
    await executeRunnableRun();
  } finally {
    engineState.tickRunning = false;
  }
}

export async function runUnifiedSchedulerEngineTickForTests(): Promise<void> {
  populateHandlerRegistry();
  validateRegisteredHandlers();
  await engineTick();
}

export function startUnifiedSchedulerEngine(config?: SchedulerEngineConfig): void {
  if (engineState.timer) return;

  if (config?.pollMs) engineState.pollMs = config.pollMs;
  if (config?.leaseSeconds) engineState.leaseSeconds = config.leaseSeconds;

  populateHandlerRegistry();
  validateRegisteredHandlers();

  engineState.timer = setInterval(() => {
    engineTick().catch((err) => {
      schedulerEngineDependencies.addLog({
        level: "error",
        source: "scheduler-engine",
        message: `Unified scheduler engine tick failed: ${err}`,
        metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err), workerId: WORKER_ID }),
      });
    });
  }, engineState.pollMs);

  schedulerEngineDependencies.addLog({
    level: "info",
    source: "scheduler-engine",
    message: "Unified scheduler engine started.",
    metadata: JSON.stringify({ pollMs: engineState.pollMs, workerId: WORKER_ID }),
  });
}

export function stopUnifiedSchedulerEngine(): void {
  if (!engineState.timer) return;
  clearInterval(engineState.timer);
  engineState.timer = null;
  schedulerEngineDependencies.addLog({
    level: "info",
    source: "scheduler-engine",
    message: "Unified scheduler engine stopped.",
    metadata: JSON.stringify({ workerId: WORKER_ID }),
  });
}
