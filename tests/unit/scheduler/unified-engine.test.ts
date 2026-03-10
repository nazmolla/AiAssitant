import { setupTestDb, teardownTestDb } from "../../helpers/test-db";

describe("unified scheduler engine", () => {
  beforeEach(() => {
    jest.resetModules();
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  test("dispatches due schedule, claims run, executes legacy task handler", async () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();
    const { runUnifiedSchedulerEngineTickForTests } = require("@/lib/scheduler/unified-engine");

    db.prepare(
      `INSERT INTO scheduled_tasks (id, task_name, frequency, interval_value, next_run_at, scope, source, task_payload, status)
       VALUES (?, ?, ?, ?, datetime('now', '-1 minute'), ?, ?, ?, ?)`
    ).run(
      "legacy-task-42",
      "Legacy Tool Call",
      "once",
      1,
      "global",
      "proactive",
      JSON.stringify({ kind: "tool_call", tool: "builtin.unregistered_tool", args: { value: 1 } }),
      "active"
    );

    db.prepare(
      `INSERT INTO scheduler_schedules (
        id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr, timezone, status, max_concurrency, misfire_policy, next_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?, datetime('now', '-1 minute'))`
    ).run(
      "sched-test-1",
      "legacy.scheduled_task.legacy-task-42",
      "Legacy Schedule",
      "system",
      null,
      "legacy.scheduled_task",
      "once",
      "once",
      "active",
      1,
      "run_immediately"
    );

    db.prepare(
      `INSERT INTO scheduler_tasks (
        id, schedule_id, task_key, name, handler_name, execution_mode, sequence_no, enabled, config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "sched-task-test-1",
      "sched-test-1",
      "primary",
      "Execute Legacy Task",
      "legacy.scheduled_task.execute",
      "sync",
      0,
      1,
      JSON.stringify({ legacyScheduledTaskId: "legacy-task-42" })
    );

    await runUnifiedSchedulerEngineTickForTests();

    const run = db.prepare("SELECT * FROM scheduler_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1").get("sched-test-1") as { status: string } | undefined;
    expect(run).toBeDefined();
    expect(run?.status).toBe("success");

    const taskRun = db.prepare("SELECT * FROM scheduler_task_runs WHERE run_id = (SELECT id FROM scheduler_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1)").get("sched-test-1") as { status: string } | undefined;
    expect(taskRun).toBeDefined();
    expect(taskRun?.status).toBe("success");

    const legacyTask = db.prepare("SELECT status, run_count FROM scheduled_tasks WHERE id = ?").get("legacy-task-42") as { status: string; run_count: number } | undefined;
    expect(legacyTask).toBeDefined();
    expect(legacyTask?.status).toBe("completed");
    expect(legacyTask?.run_count).toBe(1);
  });

  test("executes system DB maintenance handler through unified task runner", async () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();
    const { runUnifiedSchedulerEngineTickForTests } = require("@/lib/scheduler/unified-engine");

    db.prepare(
      `INSERT INTO scheduler_schedules (
        id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr, timezone, status, max_concurrency, misfire_policy, next_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?, datetime('now', '-5 minutes'))`
    ).run(
      "sched-system-maint-1",
      "system.db_maintenance.run_due.test",
      "System DB Maintenance Test",
      "system",
      null,
      "system.db_maintenance",
      "interval",
      "every:1:hour",
      "active",
      1,
      "run_immediately"
    );

    db.prepare(
      `INSERT INTO scheduler_tasks (
        id, schedule_id, task_key, name, handler_name, execution_mode, sequence_no, enabled, config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "sched-system-maint-task-1",
      "sched-system-maint-1",
      "primary",
      "Run DB maintenance if due",
      "system.db_maintenance.run_due",
      "sync",
      0,
      1,
      JSON.stringify({ source: "test" })
    );

    await runUnifiedSchedulerEngineTickForTests();

    const run = db.prepare("SELECT * FROM scheduler_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1").get("sched-system-maint-1") as { status: string } | undefined;
    expect(run).toBeDefined();
    expect(run?.status).toBe("success");

    const taskRun = db.prepare("SELECT * FROM scheduler_task_runs WHERE run_id = (SELECT id FROM scheduler_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1)").get("sched-system-maint-1") as { status: string; output_json: string | null } | undefined;
    expect(taskRun).toBeDefined();
    expect(taskRun?.status).toBe("success");
    expect(taskRun?.output_json).toContain("db_maintenance");
  });
});
