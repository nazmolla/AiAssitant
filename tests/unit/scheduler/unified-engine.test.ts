// Mock the agent loop so job scout steps don't try to make real LLM calls.
jest.mock("@/lib/agent", () => ({
  runAgentLoop: jest.fn(async () => ({
    content: "Mock agent response with sufficient content for pipeline orchestrator validation",
    toolsUsed: ["builtin.web_search"],
    pendingApprovals: [],
  })),
}));

// Mock scheduler sub-modules that would touch real services.
jest.mock("@/lib/scheduler", () => ({
  runProactiveScan: jest.fn().mockResolvedValue(undefined),
  runEmailReadBatch: jest.fn().mockResolvedValue(undefined),
  executeProactiveApprovedTool: jest.fn(),
}));

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";

describe("unified scheduler engine", () => {
  beforeEach(() => {
    jest.resetModules();
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  test("dispatches due schedule, claims run, executes unified workflow handler", async () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();
    const { runUnifiedSchedulerEngineTickForTests } = require("@/lib/scheduler/unified-engine");

    // Job scout steps require an owner_id to create the pipeline thread.
    const userId = seedTestUser({ email: "engine-unit-test@test.com", role: "user" });

    db.prepare(
      `INSERT INTO scheduler_schedules (
        id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr, timezone, status, max_concurrency, misfire_policy, next_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?, datetime('now', '-1 minute'))`
    ).run(
      "sched-test-1",
      "workflow.job_scout.pipeline.test",
      "Job Scout Test Schedule",
      "user",
      userId,
      "workflow.job_scout",
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
      "Execute Job Scout Search",
      "workflow.job_scout.search",
      "sync",
      0,
      1,
      JSON.stringify({ source: "test" })
    );

    await runUnifiedSchedulerEngineTickForTests();

    const run = db.prepare("SELECT * FROM scheduler_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1").get("sched-test-1") as { status: string } | undefined;
    expect(run).toBeDefined();
    expect(run?.status).toBe("success");

    const taskRun = db.prepare("SELECT * FROM scheduler_task_runs WHERE run_id = (SELECT id FROM scheduler_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1)").get("sched-test-1") as { status: string; log_ref: string | null } | undefined;
    expect(taskRun).toBeDefined();
    expect(taskRun?.status).toBe("success");
    expect(taskRun?.log_ref).toContain("scheduleId=sched-test-1");
    expect(taskRun?.log_ref).toContain("runId=");
    expect(taskRun?.log_ref).toContain("taskRunId=");

    const contextualLogs = db.prepare(
      "SELECT metadata FROM agent_logs WHERE source = 'scheduler-engine' AND metadata LIKE '%\"runId\"%' ORDER BY id DESC LIMIT 10"
    ).all() as Array<{ metadata: string | null }>;
    expect(contextualLogs.length).toBeGreaterThan(0);
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

  test("marks run as partial_success when one task fails and one succeeds", async () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();
    const { runUnifiedSchedulerEngineTickForTests } = require("@/lib/scheduler/unified-engine");

    db.prepare(
      `INSERT INTO scheduler_schedules (
        id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr, timezone, status, max_concurrency, misfire_policy, next_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?, datetime('now', '-5 minutes'))`
    ).run(
      "sched-partial-1",
      "workflow.partial.test",
      "Partial Success Schedule",
      "system",
      null,
      "agent.prompt",
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
      "sched-partial-task-1",
      "sched-partial-1",
      "invalid",
      "Invalid Handler Task",
      "unsupported.handler",
      "sync",
      0,
      1,
      null
    );

    db.prepare(
      `INSERT INTO scheduler_tasks (
        id, schedule_id, task_key, name, handler_name, execution_mode, sequence_no, enabled, config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "sched-partial-task-2",
      "sched-partial-1",
      "maintenance",
      "Maintenance Task",
      "system.db_maintenance.run_due",
      "sync",
      1,
      1,
      JSON.stringify({ source: "test" })
    );

    await runUnifiedSchedulerEngineTickForTests();

    const run = db.prepare("SELECT * FROM scheduler_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1").get("sched-partial-1") as { id: string; status: string } | undefined;
    expect(run).toBeDefined();
    expect(run?.status).toBe("partial_success");

    const taskRuns = db.prepare("SELECT status FROM scheduler_task_runs WHERE run_id = ? ORDER BY created_at ASC").all(run!.id) as Array<{ status: string }>;
    expect(taskRuns.length).toBe(2);
    expect(taskRuns.some((t) => t.status === "failed")).toBe(true);
    expect(taskRuns.some((t) => t.status === "success")).toBe(true);
  });
});
