import { setupTestDb, teardownTestDb } from "../../helpers/test-db";

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

  test("seeds system unified scheduler schedules for proactive, maintenance, job scout pipeline, and email monitoring", () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();
    const { initializeDatabase } = require("@/lib/db/init");

    initializeDatabase();

    const systemKeys = (db.prepare(
      `SELECT schedule_key FROM scheduler_schedules WHERE schedule_key IN (
        'system.proactive.scan',
        'system.db_maintenance.run_due',
        'system.knowledge_maintenance.run_due',
        'workflow.job_scout.pipeline',
        'workflow.email.pipeline'
      ) ORDER BY schedule_key`
    ).all() as Array<{ schedule_key: string }>).map((row) => row.schedule_key);

    expect(systemKeys).toEqual([
      "system.db_maintenance.run_due",
      "system.knowledge_maintenance.run_due",
      "system.proactive.scan",
      "workflow.email.pipeline",
      "workflow.job_scout.pipeline",
    ]);

    const jobScoutTaskCount = db.prepare(
      `SELECT COUNT(*) as c FROM scheduler_tasks
       WHERE schedule_id = (SELECT id FROM scheduler_schedules WHERE schedule_key = 'workflow.job_scout.pipeline')`
    ).get() as { c: number };

    expect(jobScoutTaskCount.c).toBe(1);

    // Email pipeline: seeded as paused (requires credentials), task uses correct handler
    const emailRow = db.prepare(
      `SELECT s.status, t.handler_name FROM scheduler_schedules s
       JOIN scheduler_tasks t ON t.schedule_id = s.id
       WHERE s.schedule_key = 'workflow.email.pipeline'`
    ).get() as { status: string; handler_name: string } | undefined;

    expect(emailRow).toBeDefined();
    expect(emailRow?.status).toBe("paused");
    expect(emailRow?.handler_name).toBe("workflow.email.run");
  });

  test("does not reseed schedules that were explicitly suppressed", () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();
    const { initializeDatabase } = require("@/lib/db/init");

    db.prepare(
      `INSERT INTO app_config (key, value, updated_at)
       VALUES ('scheduler.suppressed_schedule_keys', ?, CURRENT_TIMESTAMP)`
    ).run(JSON.stringify(["workflow.job_scout.pipeline", "system.proactive.scan"]));

    initializeDatabase();

    const presentKeys = (db.prepare(
      `SELECT schedule_key FROM scheduler_schedules
       WHERE schedule_key IN (
         'system.proactive.scan',
         'system.db_maintenance.run_due',
         'system.knowledge_maintenance.run_due',
         'workflow.job_scout.pipeline',
         'workflow.email.pipeline'
       )
       ORDER BY schedule_key`
    ).all() as Array<{ schedule_key: string }>).map((row) => row.schedule_key);

    expect(presentKeys).toEqual([
      "system.db_maintenance.run_due",
      "system.knowledge_maintenance.run_due",
      "workflow.email.pipeline",
    ]);
  });
});
