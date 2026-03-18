import { getDb } from "./connection";
import { stmt, PaginatedResult } from "./query-helpers";
import { v4 as uuid } from "uuid";
import { addLog } from "./log-queries";

export type SchedulerRunStatus =
  | "scheduled"
  | "queued"
  | "claimed"
  | "running"
  | "success"
  | "partial_success"
  | "failed"
  | "cancelled"
  | "timeout";

export type SchedulerTaskRunStatus =
  | "pending"
  | "skipped"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "timeout"
  | "retrying";

const SCHEDULER_RUN_TERMINAL = new Set<SchedulerRunStatus>(["success", "partial_success", "failed", "cancelled", "timeout"]);
const SCHEDULER_TASK_RUN_TERMINAL = new Set<SchedulerTaskRunStatus>(["success", "failed", "cancelled", "timeout", "skipped"]);

const SCHEDULER_RUN_TRANSITIONS: Record<SchedulerRunStatus, SchedulerRunStatus[]> = {
  scheduled: ["queued", "cancelled"],
  queued: ["claimed", "running", "cancelled", "timeout"],
  claimed: ["running", "failed", "cancelled", "timeout"],
  running: ["success", "partial_success", "failed", "cancelled", "timeout"],
  success: [],
  partial_success: [],
  failed: [],
  cancelled: [],
  timeout: [],
};

const SCHEDULER_TASK_RUN_TRANSITIONS: Record<SchedulerTaskRunStatus, SchedulerTaskRunStatus[]> = {
  pending: ["running", "skipped", "cancelled", "timeout", "retrying"],
  skipped: [],
  running: ["success", "failed", "cancelled", "timeout", "retrying"],
  success: [],
  failed: ["retrying"],
  cancelled: [],
  timeout: ["retrying"],
  retrying: ["running", "failed", "cancelled", "timeout"],
};

export function isValidSchedulerRunTransition(from: SchedulerRunStatus, to: SchedulerRunStatus): boolean {
  if (from === to) return true;
  return SCHEDULER_RUN_TRANSITIONS[from]?.includes(to) || false;
}

export function isValidSchedulerTaskRunTransition(from: SchedulerTaskRunStatus, to: SchedulerTaskRunStatus): boolean {
  if (from === to) return true;
  return SCHEDULER_TASK_RUN_TRANSITIONS[from]?.includes(to) || false;
}

export interface SchedulerScheduleRecord {
  id: string;
  schedule_key: string;
  name: string;
  owner_type: string;
  owner_id: string | null;
  handler_type: string;
  trigger_type: "cron" | "interval" | "once";
  trigger_expr: string;
  timezone: string;
  status: "active" | "paused" | "archived";
  max_concurrency: number;
  retry_policy_json: string | null;
  misfire_policy: string;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchedulerRunRecord {
  id: string;
  schedule_id: string;
  trigger_source: "timer" | "manual" | "api" | "recovery";
  planned_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  status: SchedulerRunStatus;
  attempt_no: number;
  correlation_id: string | null;
  summary_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SchedulerTaskRecord {
  id: string;
  schedule_id: string;
  task_key: string;
  name: string;
  handler_name: string;
  execution_mode: "sync" | "async" | "fanout";
  sequence_no: number;
  depends_on_task_id: string | null;
  timeout_sec: number | null;
  retry_policy_json: string | null;
  enabled: number;
  config_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchedulerTaskRunRecord {
  id: string;
  run_id: string;
  schedule_task_id: string;
  started_at: string | null;
  finished_at: string | null;
  status: SchedulerTaskRunStatus;
  attempt_no: number;
  output_json: string | null;
  error_code: string | null;
  error_message: string | null;
  log_ref: string | null;
  created_at: string;
}

export function listDueSchedulerSchedules(limit = 20): SchedulerScheduleRecord[] {
  return stmt(
    `SELECT s.*
     FROM scheduler_schedules s
     WHERE s.status = 'active'
       AND s.next_run_at IS NOT NULL
       AND datetime(s.next_run_at) <= datetime('now')
       AND NOT EXISTS (
         SELECT 1
         FROM scheduler_runs r
         WHERE r.schedule_id = s.id
           AND r.status IN ('queued', 'claimed', 'running')
       )
     ORDER BY s.next_run_at ASC
     LIMIT ?`
  ).all(limit) as SchedulerScheduleRecord[];
}

export function listRunnableSchedulerRuns(limit = 10): SchedulerRunRecord[] {
  return stmt(
    `SELECT *
     FROM scheduler_runs
     WHERE status = 'queued'
     ORDER BY created_at ASC
     LIMIT ?`
  ).all(limit) as SchedulerRunRecord[];
}

export function getSchedulerTasksForSchedule(scheduleId: string): SchedulerTaskRecord[] {
  return stmt(
    `SELECT *
     FROM scheduler_tasks
     WHERE schedule_id = ? AND enabled = 1
     ORDER BY sequence_no ASC, created_at ASC`
  ).all(scheduleId) as SchedulerTaskRecord[];
}

export function getSchedulerTaskRunsForRun(runId: string): SchedulerTaskRunRecord[] {
  return stmt(
    `SELECT tr.*
     FROM scheduler_task_runs tr
     JOIN scheduler_tasks t ON t.id = tr.schedule_task_id
     WHERE tr.run_id = ?
     ORDER BY t.sequence_no ASC, tr.created_at ASC`
  ).all(runId) as SchedulerTaskRunRecord[];
}

export function createSchedulerRun(scheduleId: string, triggerSource: "timer" | "manual" | "api" | "recovery" = "timer"): SchedulerRunRecord {
  const id = uuid();
  const correlationId = uuid();
  return getDb().prepare(
    `INSERT INTO scheduler_runs (
      id, schedule_id, trigger_source, planned_at, status, attempt_no, correlation_id
    ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'queued', 1, ?)
    RETURNING *`
  ).get(id, scheduleId, triggerSource, correlationId) as SchedulerRunRecord;
}

export function createSchedulerTaskRun(runId: string, scheduleTaskId: string): SchedulerTaskRunRecord {
  const id = uuid();
  return getDb().prepare(
    `INSERT INTO scheduler_task_runs (
      id, run_id, schedule_task_id, status, attempt_no
    ) VALUES (?, ?, ?, 'pending', 1)
    RETURNING *`
  ).get(id, runId, scheduleTaskId) as SchedulerTaskRunRecord;
}

export function updateSchedulerScheduleAfterDispatch(scheduleId: string, nextRunAt: string | null): void {
  getDb().prepare(
    `UPDATE scheduler_schedules
     SET next_run_at = ?,
         last_run_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(nextRunAt, scheduleId);
}

export function tryClaimSchedulerRun(runId: string, workerId: string, leaseSeconds = 60): boolean {
  const db = getDb();
  const tx = db.transaction(() => {
    const activeClaim = db.prepare(
      `SELECT run_id
       FROM scheduler_claims
       WHERE run_id = ? AND datetime(lease_expires_at) > datetime('now')`
    ).get(runId) as { run_id: string } | undefined;
    if (activeClaim) return false;

    db.prepare("DELETE FROM scheduler_claims WHERE run_id = ?").run(runId);
    db.prepare(
      `INSERT INTO scheduler_claims (run_id, worker_id, claimed_at, heartbeat_at, lease_expires_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, datetime('now', ?))`
    ).run(runId, workerId, `+${Math.max(1, leaseSeconds)} seconds`);

    const update = db.prepare(
      `UPDATE scheduler_runs
       SET status = 'claimed'
       WHERE id = ? AND status = 'queued'`
    ).run(runId);

    if (update.changes === 0) {
      db.prepare("DELETE FROM scheduler_claims WHERE run_id = ?").run(runId);
      return false;
    }
    return true;
  });
  return tx();
}

export function heartbeatSchedulerClaim(runId: string, workerId: string, leaseSeconds = 60): void {
  getDb().prepare(
    `UPDATE scheduler_claims
     SET heartbeat_at = CURRENT_TIMESTAMP,
         lease_expires_at = datetime('now', ?)
     WHERE run_id = ? AND worker_id = ?`
  ).run(`+${Math.max(1, leaseSeconds)} seconds`, runId, workerId);
}

export function releaseSchedulerClaim(runId: string): void {
  getDb().prepare("DELETE FROM scheduler_claims WHERE run_id = ?").run(runId);
}

export function setSchedulerRunStatus(runId: string, status: SchedulerRunStatus, errorMessage?: string | null): void {
  const current = stmt("SELECT status FROM scheduler_runs WHERE id = ?").get(runId) as { status: SchedulerRunStatus } | undefined;
  if (!current) return;
  if (!isValidSchedulerRunTransition(current.status, status)) {
    addLog({
      level: "warning",
      source: "scheduler.state",
      message: "Rejected invalid scheduler run status transition.",
      metadata: JSON.stringify({ runId, from: current.status, to: status }),
    });
    return;
  }

  const isTerminal = SCHEDULER_RUN_TERMINAL.has(status);
  getDb().prepare(
    `UPDATE scheduler_runs
     SET status = ?,
         started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
         finished_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE finished_at END,
         error_message = CASE WHEN ? IS NOT NULL THEN ? ELSE error_message END
     WHERE id = ?`
  ).run(status, status, isTerminal ? 1 : 0, errorMessage ?? null, errorMessage ?? null, runId);
}

export function setSchedulerTaskRunStatus(taskRunId: string, status: SchedulerTaskRunStatus, outputJson?: string | null, errorMessage?: string | null): void {
  const current = stmt("SELECT status FROM scheduler_task_runs WHERE id = ?").get(taskRunId) as { status: SchedulerTaskRunStatus } | undefined;
  if (!current) return;
  if (!isValidSchedulerTaskRunTransition(current.status, status)) {
    addLog({
      level: "warning",
      source: "scheduler.state",
      message: "Rejected invalid scheduler task-run status transition.",
      metadata: JSON.stringify({ taskRunId, from: current.status, to: status }),
    });
    return;
  }

  const isTerminal = SCHEDULER_TASK_RUN_TERMINAL.has(status);
  getDb().prepare(
    `UPDATE scheduler_task_runs
     SET status = ?,
         started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
         finished_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE finished_at END,
         output_json = CASE WHEN ? IS NOT NULL THEN ? ELSE output_json END,
         error_message = CASE WHEN ? IS NOT NULL THEN ? ELSE error_message END
     WHERE id = ?`
  ).run(status, status, isTerminal ? 1 : 0, outputJson ?? null, outputJson ?? null, errorMessage ?? null, errorMessage ?? null, taskRunId);
}

export function setSchedulerTaskRunLogRef(taskRunId: string, logRef: string | null): void {
  getDb().prepare(
    `UPDATE scheduler_task_runs
     SET log_ref = ?
     WHERE id = ?`
  ).run(logRef, taskRunId);
}

export function addSchedulerEvent(runId: string, eventType: string, message?: string, taskRunId?: string | null, metadataJson?: string | null): void {
  getDb().prepare(
    `INSERT INTO scheduler_events (run_id, task_run_id, event_type, message, metadata_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(runId, taskRunId ?? null, eventType, message ?? null, metadataJson ?? null);
}

export function getSchedulerOverviewStats(): {
  schedules_total: number;
  schedules_active: number;
  schedules_paused: number;
  runs_running: number;
  runs_failed_24h: number;
  runs_success_24h: number;
  runs_partial_24h: number;
} {
  const db = getDb();
  const schedules = db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused
     FROM scheduler_schedules`
  ).get() as { total: number; active: number | null; paused: number | null };

  const runs = db.prepare(
    `SELECT
       SUM(CASE WHEN status IN ('queued', 'claimed', 'running') THEN 1 ELSE 0 END) AS running,
       SUM(CASE WHEN status = 'failed' AND datetime(created_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS failed_24h,
       SUM(CASE WHEN status = 'success' AND datetime(created_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS success_24h,
       SUM(CASE WHEN status = 'partial_success' AND datetime(created_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS partial_24h
     FROM scheduler_runs`
  ).get() as { running: number | null; failed_24h: number | null; success_24h: number | null; partial_24h: number | null };

  return {
    schedules_total: schedules.total || 0,
    schedules_active: schedules.active || 0,
    schedules_paused: schedules.paused || 0,
    runs_running: runs.running || 0,
    runs_failed_24h: runs.failed_24h || 0,
    runs_success_24h: runs.success_24h || 0,
    runs_partial_24h: runs.partial_24h || 0,
  };
}

export function listSchedulerSchedulesPaginated(limit = 50, offset = 0, status?: string): PaginatedResult<SchedulerScheduleRecord> {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(200, limit));
  const safeOffset = Math.max(0, offset);

  const where = status ? "WHERE status = ?" : "";
  const total = status
    ? (db.prepare(`SELECT COUNT(*) AS c FROM scheduler_schedules ${where}`).get(status) as { c: number }).c
    : (db.prepare("SELECT COUNT(*) AS c FROM scheduler_schedules").get() as { c: number }).c;

  const data = status
    ? db.prepare(`SELECT * FROM scheduler_schedules ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(status, safeLimit, safeOffset)
    : db.prepare("SELECT * FROM scheduler_schedules ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(safeLimit, safeOffset);

  return {
    data: data as SchedulerScheduleRecord[],
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + (data as SchedulerScheduleRecord[]).length < total,
  };
}

export function getSchedulerScheduleById(scheduleId: string): SchedulerScheduleRecord | null {
  const row = stmt("SELECT * FROM scheduler_schedules WHERE id = ?").get(scheduleId) as SchedulerScheduleRecord | undefined;
  return row || null;
}

export function updateSchedulerScheduleByKey(scheduleKey: string, args: {
  trigger_type?: "cron" | "interval" | "once";
  trigger_expr?: string;
  status?: "active" | "paused" | "archived";
  next_run_at?: string;
}): void {
  getDb().prepare(
    `UPDATE scheduler_schedules
     SET trigger_type = COALESCE(?, trigger_type),
         trigger_expr = COALESCE(?, trigger_expr),
         status = COALESCE(?, status),
         next_run_at = COALESCE(?, next_run_at),
         updated_at = CURRENT_TIMESTAMP
     WHERE schedule_key = ?`
  ).run(
    args.trigger_type ?? null,
    args.trigger_expr ?? null,
    args.status ?? null,
    args.next_run_at ?? null,
    scheduleKey
  );
}

export function updateSchedulerScheduleById(scheduleId: string, args: {
  name?: string;
  trigger_type?: "cron" | "interval" | "once";
  trigger_expr?: string;
  status?: "active" | "paused" | "archived";
  owner_type?: string;
  owner_id?: string | null;
  next_run_at?: string | null;
}): void {
  getDb().prepare(
    `UPDATE scheduler_schedules
     SET name = COALESCE(?, name),
         trigger_type = COALESCE(?, trigger_type),
         trigger_expr = COALESCE(?, trigger_expr),
         status = COALESCE(?, status),
         owner_type = COALESCE(?, owner_type),
         owner_id = COALESCE(?, owner_id),
         next_run_at = COALESCE(?, next_run_at),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    args.name ?? null,
    args.trigger_type ?? null,
    args.trigger_expr ?? null,
    args.status ?? null,
    args.owner_type ?? null,
    args.owner_id ?? null,
    args.next_run_at === undefined ? null : args.next_run_at,
    scheduleId,
  );
}

export function deleteSchedulerScheduleById(scheduleId: string): number {
  const db = getDb();
  const existing = db.prepare("SELECT schedule_key FROM scheduler_schedules WHERE id = ?").get(scheduleId) as { schedule_key?: string } | undefined;

  const result = db.prepare("DELETE FROM scheduler_schedules WHERE id = ?").run(scheduleId);

  const scheduleKey = typeof existing?.schedule_key === "string" ? existing.schedule_key.trim() : "";
  if (result.changes > 0 && scheduleKey) {
    const configKey = "scheduler.suppressed_schedule_keys";
    const row = db.prepare("SELECT value FROM app_config WHERE key = ?").get(configKey) as { value?: string } | undefined;
    let suppressed = new Set<string>();

    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value) as unknown;
        if (Array.isArray(parsed)) {
          suppressed = new Set(
            parsed
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean),
          );
        }
      } catch {
        suppressed = new Set<string>();
      }
    }

    suppressed.add(scheduleKey);
    const value = JSON.stringify(Array.from(suppressed).slice(-256));
    db.prepare(
      `INSERT INTO app_config (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP`
    ).run(configKey, value);
  }

  return result.changes;
}

export function createSchedulerSchedule(args: {
  schedule_key: string;
  name: string;
  handler_type: string;
  trigger_type: "cron" | "interval" | "once";
  trigger_expr: string;
  status?: "active" | "paused" | "archived";
  owner_type?: string;
  owner_id?: string | null;
  max_concurrency?: number;
  retry_policy_json?: string | null;
  misfire_policy?: string;
  next_run_at?: string | null;
}): SchedulerScheduleRecord {
  const id = uuid();
  getDb().prepare(
    `INSERT INTO scheduler_schedules (
      id, schedule_key, name, owner_type, owner_id, handler_type,
      trigger_type, trigger_expr, timezone, status, max_concurrency,
      retry_policy_json, misfire_policy, next_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?, ?, ?)`
  ).run(
    id,
    args.schedule_key,
    args.name,
    args.owner_type || "user",
    args.owner_id ?? null,
    args.handler_type,
    args.trigger_type,
    args.trigger_expr,
    args.status || "active",
    Math.max(1, args.max_concurrency || 1),
    args.retry_policy_json ?? JSON.stringify({ strategy: "none", maxAttempts: 1 }),
    args.misfire_policy || "run_immediately",
    args.next_run_at ?? null,
  );

  const created = getSchedulerScheduleById(id);
  if (!created) {
    throw new Error("Failed to create scheduler schedule");
  }
  return created;
}

export function upsertSchedulerScheduleByKey(args: {
  schedule_key: string;
  name: string;
  handler_type: string;
  trigger_type: "cron" | "interval" | "once";
  trigger_expr: string;
  status: "active" | "paused" | "archived";
  owner_type?: string;
  owner_id?: string | null;
  max_concurrency?: number;
  retry_policy_json?: string | null;
  misfire_policy?: string;
  next_run_at?: string | null;
}): void {
  const existing = getDb().prepare("SELECT id FROM scheduler_schedules WHERE schedule_key = ?").get(args.schedule_key) as { id: string } | undefined;
  const id = existing?.id || uuid();

  getDb().prepare(
    `INSERT INTO scheduler_schedules (
      id, schedule_key, name, owner_type, owner_id, handler_type,
      trigger_type, trigger_expr, timezone, status, max_concurrency,
      retry_policy_json, misfire_policy, next_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?, ?, ?)
    ON CONFLICT(schedule_key) DO UPDATE SET
      name = excluded.name,
      owner_type = excluded.owner_type,
      owner_id = excluded.owner_id,
      handler_type = excluded.handler_type,
      trigger_type = excluded.trigger_type,
      trigger_expr = excluded.trigger_expr,
      status = excluded.status,
      max_concurrency = excluded.max_concurrency,
      retry_policy_json = excluded.retry_policy_json,
      misfire_policy = excluded.misfire_policy,
      next_run_at = COALESCE(excluded.next_run_at, scheduler_schedules.next_run_at),
      updated_at = CURRENT_TIMESTAMP`
  ).run(
    id,
    args.schedule_key,
    args.name,
    args.owner_type || "system",
    args.owner_id ?? null,
    args.handler_type,
    args.trigger_type,
    args.trigger_expr,
    args.status,
    Math.max(1, args.max_concurrency || 1),
    args.retry_policy_json ?? JSON.stringify({ strategy: "none", maxAttempts: 1 }),
    args.misfire_policy || "run_immediately",
    args.next_run_at ?? null,
  );
}

export function listSchedulerRunsBySchedule(scheduleId: string, limit = 25): SchedulerRunRecord[] {
  return stmt(
    `SELECT *
     FROM scheduler_runs
     WHERE schedule_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(scheduleId, Math.max(1, Math.min(200, limit))) as SchedulerRunRecord[];
}

export function listSchedulerRunsPaginated(limit = 50, offset = 0, status?: string, scheduleId?: string): PaginatedResult<SchedulerRunRecord> {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(200, limit));
  const safeOffset = Math.max(0, offset);
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (scheduleId) {
    clauses.push("schedule_id = ?");
    params.push(scheduleId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM scheduler_runs ${where}`).get(...params) as { c: number }).c;
  const data = db.prepare(`SELECT * FROM scheduler_runs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, safeLimit, safeOffset) as SchedulerRunRecord[];

  return {
    data,
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + data.length < total,
  };
}

export function getSchedulerRunById(runId: string): SchedulerRunRecord | null {
  const row = stmt("SELECT * FROM scheduler_runs WHERE id = ?").get(runId) as SchedulerRunRecord | undefined;
  return row || null;
}

export function getSchedulerRunWithContext(runId: string): {
  run: SchedulerRunRecord;
  schedule: SchedulerScheduleRecord | null;
  task_runs: SchedulerTaskRunRecord[];
} | null {
  const run = getSchedulerRunById(runId);
  if (!run) return null;
  return {
    run,
    schedule: getSchedulerScheduleById(run.schedule_id),
    task_runs: getSchedulerTaskRunsForRun(runId),
  };
}

export function updateSchedulerScheduleStatus(scheduleId: string, status: "active" | "paused" | "archived"): void {
  getDb().prepare(
    `UPDATE scheduler_schedules
     SET status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(status, scheduleId);
}

export function updateSchedulerTaskGraph(scheduleId: string, tasks: Array<{
  id?: string;
  task_key: string;
  name: string;
  handler_name: string;
  execution_mode?: "sync" | "async" | "fanout";
  sequence_no?: number;
  depends_on_task_id?: string | null;
  depends_on_task_key?: string | null;
  timeout_sec?: number | null;
  retry_policy_json?: string | null;
  enabled?: number;
  config_json?: string | null;
}>, replace = false): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO scheduler_tasks (
      id, schedule_id, task_key, name, handler_name, execution_mode,
      sequence_no, depends_on_task_id, timeout_sec, retry_policy_json, enabled, config_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    `UPDATE scheduler_tasks
     SET task_key = ?,
         name = ?,
         handler_name = ?,
         execution_mode = ?,
         sequence_no = ?,
         depends_on_task_id = ?,
         timeout_sec = ?,
         retry_policy_json = ?,
         enabled = ?,
         config_json = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND schedule_id = ?`
  );

  db.transaction(() => {
    const seenIds: string[] = [];
    const keyToId = new Map<string, string>();
    for (const task of tasks) {
      const id = task.id || uuid();
      seenIds.push(id);
      keyToId.set(task.task_key, id);
    }

    for (const task of tasks) {
      const id = (task.id && seenIds.includes(task.id)) ? task.id : keyToId.get(task.task_key) || uuid();
      const mode = task.execution_mode || "sync";
      const seq = Number.isFinite(task.sequence_no) ? Number(task.sequence_no) : 0;
      const enabled = task.enabled === 0 ? 0 : 1;
      const timeout = task.timeout_sec ?? null;
      const retry = task.retry_policy_json ?? null;
      const config = task.config_json ?? null;
      const dependsId = task.depends_on_task_id ?? (task.depends_on_task_key ? keyToId.get(task.depends_on_task_key) ?? null : null);

      const existing = db.prepare("SELECT id FROM scheduler_tasks WHERE id = ? AND schedule_id = ?").get(id, scheduleId) as { id: string } | undefined;
      if (existing) {
        update.run(task.task_key, task.name, task.handler_name, mode, seq, dependsId, timeout, retry, enabled, config, id, scheduleId);
      } else {
        insert.run(id, scheduleId, task.task_key, task.name, task.handler_name, mode, seq, dependsId, timeout, retry, enabled, config);
      }
    }

    if (replace) {
      if (seenIds.length === 0) {
        db.prepare("DELETE FROM scheduler_tasks WHERE schedule_id = ?").run(scheduleId);
      } else {
        const placeholders = seenIds.map(() => "?").join(",");
        db.prepare(`DELETE FROM scheduler_tasks WHERE schedule_id = ? AND id NOT IN (${placeholders})`).run(scheduleId, ...seenIds);
      }
    }
  })();
}

export function listEnabledSchedulerTaskHandlers(): Array<{ handler_name: string; count: number }> {
  return stmt(
    `SELECT handler_name, COUNT(*) as count
     FROM scheduler_tasks
     WHERE enabled = 1
     GROUP BY handler_name`
  ).all() as Array<{ handler_name: string; count: number }>;
}

export function getSchedulerQueueHealthMetrics(): {
  queued: number;
  claimed: number;
  running: number;
  failed_1h: number;
  success_1h: number;
  partial_1h: number;
  stale_claims: number;
} {
  const queue = stmt(
    `SELECT
       SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
       SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed,
       SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
       SUM(CASE WHEN status = 'failed' AND datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) AS failed_1h,
       SUM(CASE WHEN status = 'success' AND datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) AS success_1h,
       SUM(CASE WHEN status = 'partial_success' AND datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) AS partial_1h
     FROM scheduler_runs`
  ).get() as {
    queued: number | null;
    claimed: number | null;
    running: number | null;
    failed_1h: number | null;
    success_1h: number | null;
    partial_1h: number | null;
  };

  const staleClaims = stmt(
    `SELECT COUNT(*) AS c
     FROM scheduler_claims
     WHERE datetime(lease_expires_at) <= datetime('now')`
  ).get() as { c: number };

  return {
    queued: queue.queued || 0,
    claimed: queue.claimed || 0,
    running: queue.running || 0,
    failed_1h: queue.failed_1h || 0,
    success_1h: queue.success_1h || 0,
    partial_1h: queue.partial_1h || 0,
    stale_claims: staleClaims.c || 0,
  };
}
