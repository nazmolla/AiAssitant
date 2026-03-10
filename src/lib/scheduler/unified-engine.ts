import {
  addLog,
  addSchedulerEvent,
  createSchedulerRun,
  createSchedulerTaskRun,
  getSchedulerTasksForSchedule,
  getSchedulerTaskRunsForRun,
  heartbeatSchedulerClaim,
  listDueSchedulerSchedules,
  listRunnableSchedulerRuns,
  releaseSchedulerClaim,
  setSchedulerRunStatus,
  setSchedulerTaskRunStatus,
  tryClaimSchedulerRun,
  updateSchedulerScheduleAfterDispatch,
  type SchedulerScheduleRecord,
  runDbMaintenanceIfDue,
} from "@/lib/db";
import { executeLegacyScheduledTaskById, runProactiveScan } from "@/lib/scheduler";
import { runKnowledgeMaintenanceIfDue } from "@/lib/knowledge-maintenance";

const ENGINE_POLL_MS = 10_000;
const CLAIM_LEASE_SECONDS = 60;
const WORKER_ID = `scheduler-worker-${process.pid}`;

let _engineTimer: ReturnType<typeof setInterval> | null = null;
let _engineTickRunning = false;

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
      metadata: JSON.stringify({ scheduleId: schedule.id, tasks: tasks.length, correlationId: run.correlation_id }),
    });
  }
}

async function executeTaskRun(taskRunId: string, handlerName: string, configJson: string | null): Promise<void> {
  setSchedulerTaskRunStatus(taskRunId, "running");

  try {
    if (handlerName === "legacy.scheduled_task.execute") {
      let legacyTaskId = "";
      try {
        const parsed = JSON.parse(configJson || "{}");
        legacyTaskId = typeof parsed.legacyScheduledTaskId === "string" ? parsed.legacyScheduledTaskId : "";
      } catch {
        legacyTaskId = "";
      }
      if (!legacyTaskId) throw new Error("Missing legacyScheduledTaskId in scheduler task config.");
      await executeLegacyScheduledTaskById(legacyTaskId);
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ legacyScheduledTaskId: legacyTaskId }));
      return;
    }

    if (handlerName === "system.proactive.scan") {
      await runProactiveScan();
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "proactive_scan" }));
      return;
    }

    if (handlerName === "system.db_maintenance.run_due") {
      const result = runDbMaintenanceIfDue();
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "db_maintenance", result }));
      return;
    }

    if (handlerName === "system.knowledge_maintenance.run_due") {
      const result = runKnowledgeMaintenanceIfDue();
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
        metadata: configJson,
      });
      setSchedulerTaskRunStatus(taskRunId, "success", JSON.stringify({ kind: "job_scout_pipeline", handlerName }));
      return;
    }

    throw new Error(`Unsupported scheduler handler: ${handlerName}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
    addSchedulerEvent(claimed.id, "run_started", "Scheduler run execution started");

    const taskRuns = getSchedulerTaskRunsForRun(claimed.id);
    let failures = 0;

    for (const taskRun of taskRuns) {
      heartbeatSchedulerClaim(claimed.id, WORKER_ID, CLAIM_LEASE_SECONDS);

      const task = getSchedulerTasksForSchedule(claimed.schedule_id).find((t) => t.id === taskRun.schedule_task_id);
      if (!task) {
        failures += 1;
        setSchedulerTaskRunStatus(taskRun.id, "failed", null, "Scheduler task definition missing.");
        continue;
      }

      try {
        await executeTaskRun(taskRun.id, task.handler_name, task.config_json);
      } catch {
        failures += 1;
        // Keep processing remaining tasks for partial-success visibility.
      }
    }

    const finalStatus = failures === 0 ? "success" : failures < taskRuns.length ? "partial_success" : "failed";
    setSchedulerRunStatus(claimed.id, finalStatus);
    addSchedulerEvent(claimed.id, "run_finished", `Run completed with status ${finalStatus}`, null, JSON.stringify({ failures, taskCount: taskRuns.length }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSchedulerRunStatus(claimed.id, "failed", message);
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
