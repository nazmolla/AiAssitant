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

function computeNextRunAt(schedule: SchedulerScheduleRecord): string | null {
  if (schedule.trigger_type === "once") return null;

  if (schedule.trigger_type === "interval") {
    const match = /^every:(\d+):(second|minute|hour|day|week|month)$/.exec(schedule.trigger_expr || "");
    if (!match) return null;

    const interval = Math.max(1, Number(match[1] || 1));
    const unit = match[2];
    const now = new Date();

    if (unit === "second") now.setSeconds(now.getSeconds() + interval);
    if (unit === "minute") now.setMinutes(now.getMinutes() + interval);
    if (unit === "hour") now.setHours(now.getHours() + interval);
    if (unit === "day") now.setDate(now.getDate() + interval);
    if (unit === "week") now.setDate(now.getDate() + interval * 7);
    if (unit === "month") now.setMonth(now.getMonth() + interval);
    return now.toISOString();
  }

  // Cron scheduling will be enabled in a follow-up phase.
  return null;
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

    updateSchedulerScheduleAfterDispatch(schedule.id, computeNextRunAt(schedule));
    addSchedulerEvent(run.id, "run_dispatched", `Dispatched ${tasks.length} task(s)`, null, JSON.stringify({ scheduleId: schedule.id }));

    addLog({
      level: "info",
      source: "scheduler-engine",
      message: `Dispatched scheduler run ${run.id}`,
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

async function executeTaskRun(taskRunId: string, runId: string, handlerName: string, configJson: string | null, scheduleId: string): Promise<void> {
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
      await runAgentLoop(threadId, prompt, undefined, undefined, undefined, userId);
      logSchedulerExecution("info", "Scheduler prompt task completed successfully.", context, { threadId, userId });
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "agent_prompt", threadId, userId }));
      return;
    }

    if (handlerName === "system.proactive.scan") {
      await runProactiveScan({ scheduleId, runId, taskRunId, handlerName });
      logSchedulerExecution("info", "Proactive scan task completed successfully.", context);
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "proactive_scan" }));
      return;
    }

    if (handlerName === "system.email.read_incoming") {
      await runEmailReadBatch({ scheduleId, runId, taskRunId, handlerName });
      logSchedulerExecution("info", "Email read task completed successfully.", context);
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "email_read_incoming" }));
      return;
    }

    if (handlerName === "system.db_maintenance.run_due") {
      const result = runDbMaintenanceIfDue();
      logSchedulerExecution("info", "DB maintenance task completed.", context, {
        maintenanceSkipped: result === null,
        ...(result || {}),
      });
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "db_maintenance", result }));
      return;
    }

    if (handlerName === "system.knowledge_maintenance.run_due") {
      const result = runKnowledgeMaintenanceIfDue();
      logSchedulerExecution("info", "Knowledge maintenance task completed.", context, result as unknown as Record<string, unknown>);
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "knowledge_maintenance", result }));
      return;
    }

    if (handlerName.startsWith("workflow.job_scout.")) {
      // Job Scout pipeline tasks are represented in unified scheduler and will be
      // wired to concrete executors in a follow-up issue.
      addLog({
        level: "info",
        source: "scheduler-engine",
        message: `Job Scout pipeline placeholder executed: ${handlerName}`,
        metadata: JSON.stringify({ ...context, configJson }),
      });
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "job_scout_pipeline", handlerName }));
      return;
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
    const taskRunByTaskId = new Map(taskRuns.map((taskRun) => [taskRun.schedule_task_id, taskRun]));
    let failures = 0;

    for (const taskRun of taskRuns) {
      if (taskRun.status !== "pending" && taskRun.status !== "retrying") {
        addSchedulerEvent(claimed.id, "task_skipped", `Skipped task-run ${taskRun.id} in terminal state ${taskRun.status}`, taskRun.id);
        continue;
      }

      heartbeatSchedulerClaim(claimed.id, WORKER_ID, CLAIM_LEASE_SECONDS);

      const task = getSchedulerTasksForSchedule(claimed.schedule_id).find((t) => t.id === taskRun.schedule_task_id);
      if (!task) {
        failures += 1;
        setSchedulerTaskRunStatus(taskRun.id, "failed", null, "Scheduler task definition missing.");
        continue;
      }

      if (task.depends_on_task_id) {
        const dependencyRun = taskRunByTaskId.get(task.depends_on_task_id);
        if (!dependencyRun || dependencyRun.status !== "success") {
          setSchedulerTaskRunStatus(taskRun.id, "skipped", null, "Dependency did not complete successfully.");
          addSchedulerEvent(claimed.id, "task_skipped", `Skipped ${taskRun.id} due to dependency state.`, taskRun.id);
          continue;
        }
      }

      try {
        await executeTaskRun(taskRun.id, claimed.id, task.handler_name, task.config_json, claimed.schedule_id);
      } catch {
        failures += 1;
        // Keep processing remaining tasks for partial-success visibility.
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
