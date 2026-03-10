import { setupTestDb, teardownTestDb } from "../../helpers/test-db";

describe("scheduler status transition guardrails", () => {
  beforeEach(() => {
    jest.resetModules();
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  test("rejects invalid run status transition", () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();
    const { setSchedulerRunStatus } = require("@/lib/db/queries");

    db.prepare(
      `INSERT INTO scheduler_schedules (
        id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr, timezone, status, max_concurrency, misfire_policy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?)`
    ).run("sched-x", "test.transition.run.1", "Transition Test", "system", null, "test", "once", "once", "active", 1, "run_immediately");

    db.prepare(
      `INSERT INTO scheduler_runs (id, schedule_id, trigger_source, status, attempt_no)
       VALUES (?, ?, ?, ?, ?)`
    ).run("run-transition-1", "sched-x", "api", "queued", 1);

    setSchedulerRunStatus("run-transition-1", "success");

    const row = db.prepare("SELECT status FROM scheduler_runs WHERE id = ?").get("run-transition-1") as { status: string };
    expect(row.status).toBe("queued");
  });

  test("allows valid run status transition", () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();
    const { setSchedulerRunStatus } = require("@/lib/db/queries");

    db.prepare(
      `INSERT INTO scheduler_schedules (
        id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr, timezone, status, max_concurrency, misfire_policy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?)`
    ).run("sched-x", "test.transition.run.2", "Transition Test", "system", null, "test", "once", "once", "active", 1, "run_immediately");

    db.prepare(
      `INSERT INTO scheduler_runs (id, schedule_id, trigger_source, status, attempt_no)
       VALUES (?, ?, ?, ?, ?)`
    ).run("run-transition-2", "sched-x", "api", "queued", 1);

    setSchedulerRunStatus("run-transition-2", "claimed");

    const row = db.prepare("SELECT status FROM scheduler_runs WHERE id = ?").get("run-transition-2") as { status: string };
    expect(row.status).toBe("claimed");
  });

  test("rejects invalid task-run status transition", () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();
    const { setSchedulerTaskRunStatus } = require("@/lib/db/queries");

    db.prepare(
      `INSERT INTO scheduler_schedules (
        id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr, timezone, status, max_concurrency, misfire_policy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?)`
    ).run("sched-task-parent", "test.transition.task.1", "Transition Task Test", "system", null, "test", "once", "once", "active", 1, "run_immediately");

    db.prepare(
      `INSERT INTO scheduler_tasks (
        id, schedule_id, task_key, name, handler_name, execution_mode, sequence_no, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("task-x", "sched-task-parent", "primary", "Primary", "test.handler", "sync", 0, 1);

    db.prepare(
      `INSERT INTO scheduler_runs (id, schedule_id, trigger_source, status, attempt_no)
       VALUES (?, ?, ?, ?, ?)`
    ).run("run-x", "sched-task-parent", "api", "running", 1);

    db.prepare(
      `INSERT INTO scheduler_task_runs (id, run_id, schedule_task_id, status, attempt_no)
       VALUES (?, ?, ?, ?, ?)`
    ).run("task-transition-1", "run-x", "task-x", "pending", 1);

    setSchedulerTaskRunStatus("task-transition-1", "success");

    const row = db.prepare("SELECT status FROM scheduler_task_runs WHERE id = ?").get("task-transition-1") as { status: string };
    expect(row.status).toBe("pending");
  });
});
