jest.mock("@/lib/agent", () => ({
  runAgentLoop: jest.fn(async () => ({
    content: "Mock response",
    toolsUsed: [],
    pendingApprovals: [],
  })),
}));

jest.mock("@/lib/scheduler", () => ({
  runProactiveScan: jest.fn().mockResolvedValue(undefined),
  runEmailReadBatch: jest.fn().mockResolvedValue(undefined),
  executeProactiveApprovedTool: jest.fn(),
}));

import { setupTestDb, teardownTestDb } from "../../helpers/test-db";

describe("scheduler handler registry", () => {
  beforeEach(() => {
    jest.resetModules();
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  test("registerHandler adds handler to registry", () => {
    const { registerHandler, getRegisteredHandlers } = require("@/lib/scheduler/unified-engine");
    registerHandler("custom.test.handler");
    expect(getRegisteredHandlers().has("custom.test.handler")).toBe(true);
  });

  test("getRegisteredHandlers returns a read-only set", () => {
    const { getRegisteredHandlers } = require("@/lib/scheduler/unified-engine");
    const handlers = getRegisteredHandlers();
    expect(typeof handlers.has).toBe("function");
    expect(typeof handlers.forEach).toBe("function");
  });

  test("populateHandlerRegistry includes agent.prompt", () => {
    const { runUnifiedSchedulerEngineTickForTests, getRegisteredHandlers } = require("@/lib/scheduler/unified-engine");
    // runUnifiedSchedulerEngineTickForTests calls populateHandlerRegistry
    runUnifiedSchedulerEngineTickForTests();
    expect(getRegisteredHandlers().has("agent.prompt")).toBe(true);
  });

  test("populateHandlerRegistry includes all batch job handlers", () => {
    const { runUnifiedSchedulerEngineTickForTests, getRegisteredHandlers } = require("@/lib/scheduler/unified-engine");
    runUnifiedSchedulerEngineTickForTests();
    const handlers = getRegisteredHandlers();

    // All 10 expected handler names from batch jobs + agent.prompt
    const expected = [
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
    ];

    for (const name of expected) {
      expect(handlers.has(name)).toBe(true);
    }
    expect(handlers.size).toBe(expected.length);
  });

  test("unregistered handler type logged as error during validation", () => {
    const { getDb } = require("@/lib/db/connection");
    const db = getDb();

    // Insert a task with an unknown handler name
    db.prepare(
      `INSERT INTO scheduler_schedules (id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr, timezone, status, max_concurrency, misfire_policy, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?, datetime('now', '+1 hour'))`
    ).run("sched-unknown-1", "test.unknown", "Unknown", "system", null, "test.unknown", "once", "once", "active", 1, "skip");

    db.prepare(
      `INSERT INTO scheduler_tasks (id, schedule_id, task_key, name, handler_name, execution_mode, sequence_no, enabled, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("task-unknown-1", "sched-unknown-1", "primary", "Unknown Task", "totally.unknown.handler", "sync", 0, 1, null);

    // Trigger tick which calls populateHandlerRegistry + engineTick
    const { runUnifiedSchedulerEngineTickForTests } = require("@/lib/scheduler/unified-engine");
    runUnifiedSchedulerEngineTickForTests();

    const errorLog = db.prepare(
      "SELECT * FROM agent_logs WHERE source = 'scheduler-engine' AND level = 'error' AND message LIKE '%unregistered%'"
    ).get();
    expect(errorLog).toBeDefined();
  });
});

describe("batch job getHandlerNames", () => {
  test("each batch job returns handler names consistent with canExecuteHandler", () => {
    const { getAllHandlerNames } = require("@/lib/scheduler/batch-jobs");
    const { findBatchJobForHandler } = require("@/lib/scheduler/batch-jobs");

    const allNames = getAllHandlerNames();
    expect(allNames.length).toBeGreaterThan(0);

    for (const name of allNames) {
      const job = findBatchJobForHandler(name);
      expect(job).toBeDefined();
      expect(job!.canExecuteHandler(name)).toBe(true);
    }
  });

  test("getAllHandlerNames returns exactly 9 batch job handlers", () => {
    const { getAllHandlerNames } = require("@/lib/scheduler/batch-jobs");
    const names = getAllHandlerNames();
    // 9 handlers across 5 batch jobs (proactive: 1, email: 1, cleanup: 1, knowledge: 1, job_scout: 5)
    expect(names).toHaveLength(9);
  });
});
