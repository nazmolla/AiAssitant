import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";

describe("unified scheduler foundation schema", () => {
  beforeEach(() => {
    jest.resetModules();
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  test("creates unified scheduler tables", () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();

    const tableNames = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'scheduler_%'").all() as Array<{ name: string }>).map((r) => r.name);

    expect(tableNames).toEqual(expect.arrayContaining([
      "scheduler_schedules",
      "scheduler_tasks",
      "scheduler_runs",
      "scheduler_task_runs",
      "scheduler_claims",
      "scheduler_events",
    ]));
  });

  test("backfills legacy scheduled_tasks into scheduler schedules and tasks", () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();
    const { initializeDatabase } = require("@/lib/db/init");

    const userId = seedTestUser({ email: "scheduler-migrate@test.com", role: "admin" });

    db.prepare(
      `INSERT INTO scheduled_tasks (id, user_id, task_name, frequency, interval_value, next_run_at, scope, source, task_payload, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "legacy-task-1",
      userId,
      "Legacy Job Scout",
      "daily",
      1,
      new Date(Date.now() + 60_000).toISOString(),
      "user",
      "user_request",
      JSON.stringify({ kind: "agent_prompt", prompt: "run scout" }),
      "active"
    );

    initializeDatabase();

    const schedule = db.prepare("SELECT * FROM scheduler_schedules WHERE schedule_key = ?").get("legacy.scheduled_task.legacy-task-1") as Record<string, unknown> | undefined;
    expect(schedule).toBeDefined();
    expect(schedule?.handler_type).toBe("legacy.scheduled_task");

    const task = db.prepare("SELECT * FROM scheduler_tasks WHERE schedule_id = ?").get(schedule?.id) as Record<string, unknown> | undefined;
    expect(task).toBeDefined();
    expect(task?.handler_name).toBe("legacy.scheduled_task.execute");
  });

  test("seeds system unified scheduler schedules for proactive, maintenance, and job scout pipeline", () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();
    const { initializeDatabase } = require("@/lib/db/init");

    initializeDatabase();

    const systemKeys = (db.prepare(
      `SELECT schedule_key FROM scheduler_schedules WHERE schedule_key IN (
        'system.proactive.scan',
        'system.db_maintenance.run_due',
        'system.knowledge_maintenance.run_due',
        'workflow.job_scout.pipeline'
      ) ORDER BY schedule_key`
    ).all() as Array<{ schedule_key: string }>).map((row) => row.schedule_key);

    expect(systemKeys).toEqual([
      "system.db_maintenance.run_due",
      "system.knowledge_maintenance.run_due",
      "system.proactive.scan",
      "workflow.job_scout.pipeline",
    ]);

    const jobScoutTaskCount = db.prepare(
      `SELECT COUNT(*) as c FROM scheduler_tasks
       WHERE schedule_id = (SELECT id FROM scheduler_schedules WHERE schedule_key = 'workflow.job_scout.pipeline')`
    ).get() as { c: number };

    expect(jobScoutTaskCount.c).toBe(5);
  });
});
