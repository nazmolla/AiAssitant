/**
 * Integration tests for the unified scheduler engine execution layer.
 *
 * These tests use an in-memory SQLite database and verify:
 *   - Single task execution succeeds and emits the right log messages.
 *   - A dependency chain (A→B→C) where all predecessors succeed runs all steps.
 *   - A failure in step A causes steps B and C to be skipped with clear reasons.
 *   - Independent tasks (no deps) both run regardless of each other.
 *   - The job scout pipeline shares a single conversation thread across all steps.
 *   - Log entries include task names, handlers, and outcome details.
 */

import { installAuthMocks } from "../../helpers/mock-auth";

installAuthMocks();

// Mock the agent module — we are not testing LLM correctness here.
jest.mock("@/lib/agent", () => ({
  runAgentLoop: jest.fn(async () => ({
    content: "Mock agent response",
    toolsUsed: 2,
    pendingApprovals: [],
  })),
}));

// Mock scheduler sub-modules that would interact with real services.
jest.mock("@/lib/scheduler", () => ({
  runProactiveScan: jest.fn().mockResolvedValue(undefined),
  runEmailReadBatch: jest.fn().mockResolvedValue(undefined),
  executeProactiveApprovedTool: jest.fn(),
}));

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { getDb } from "@/lib/db/connection";
import {
  createSchedulerRun,
  createSchedulerTaskRun,
  getSchedulerTaskRunsForRun,
} from "@/lib/db";
import { runUnifiedSchedulerEngineTickForTests } from "@/lib/scheduler/unified-engine";
import { runAgentLoop } from "@/lib/agent";

let ownerId: string;

beforeAll(() => {
  setupTestDb();
  ownerId = seedTestUser({ email: "engine-test@test.com", role: "admin" });
});

afterAll(() => {
  teardownTestDb();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function insertSchedule(id: string, name: string, handlerType = "system.db_maintenance"): void {
  getDb()
    .prepare(
      `INSERT INTO scheduler_schedules
         (id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr,
          timezone, status, max_concurrency, misfire_policy, next_run_at)
       VALUES (?, ?, ?, 'user', ?, ?, 'interval', 'every:1:hour', 'UTC', 'active', 1,
               'run_immediately', datetime('now', '+1 hour'))`
    )
    .run(id, `test.${id}`, name, ownerId, handlerType);
}

function insertTask(
  id: string,
  schedId: string,
  taskKey: string,
  name: string,
  handlerName: string,
  seqNo: number,
  dependsOnId: string | null = null,
  configJson: string | null = null,
): void {
  getDb()
    .prepare(
      `INSERT INTO scheduler_tasks
         (id, schedule_id, task_key, name, handler_name, execution_mode,
          sequence_no, enabled, depends_on_task_id, config_json)
       VALUES (?, ?, ?, ?, ?, 'sync', ?, 1, ?, ?)`
    )
    .run(id, schedId, taskKey, name, handlerName, seqNo, dependsOnId, configJson);
}

/** Read all scheduler-engine log entries that reference a specific runId. */
function logsForRun(runId: string): Array<{ message: string; level: string }> {
  return getDb()
    .prepare(
      `SELECT message, level FROM agent_logs
       WHERE source = 'scheduler-engine' AND metadata LIKE ?
       ORDER BY created_at ASC`
    )
    .all(`%${runId}%`) as Array<{ message: string; level: string }>;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("scheduler engine: single task execution", () => {
  test("a single db_maintenance task runs to success and emits informative logs", async () => {
    insertSchedule("sched-e1", "Single Task Test");
    insertTask("task-e1-1", "sched-e1", "maint", "DB Maintenance", "system.db_maintenance.run_due", 0);

    const run = createSchedulerRun("sched-e1", "api");
    createSchedulerTaskRun(run.id, "task-e1-1");

    await runUnifiedSchedulerEngineTickForTests();

    const taskRuns = getSchedulerTaskRunsForRun(run.id);
    expect(taskRuns).toHaveLength(1);
    expect(taskRuns[0].status).toBe("success");
    expect(taskRuns[0].started_at).not.toBeNull();
    expect(taskRuns[0].finished_at).not.toBeNull();

    const msgs = logsForRun(run.id).map((l) => l.message);
    expect(msgs.some((m) => m.includes("claimed and started"))).toBe(true);
    // Startup log includes the task name.
    expect(msgs.some((m) => m.includes("DB Maintenance") && m.includes("maint"))).toBe(true);
    // Completion log is present.
    expect(msgs.some((m) => m.includes("DB maintenance task completed"))).toBe(true);
    expect(msgs.some((m) => m.includes("Scheduler run completed"))).toBe(true);
  });
});

describe("scheduler engine: dependency chain execution", () => {
  test(
    "three-task chain A→B→C: all tasks complete when predecessors succeed (regression: stale-map bug)",
    async () => {
      insertSchedule("sched-e2", "Dependency Chain Test");
      insertTask("task-e2-1", "sched-e2", "step_a", "Step A", "system.db_maintenance.run_due", 0, null);
      insertTask("task-e2-2", "sched-e2", "step_b", "Step B", "system.db_maintenance.run_due", 1, "task-e2-1");
      insertTask("task-e2-3", "sched-e2", "step_c", "Step C", "system.db_maintenance.run_due", 2, "task-e2-2");

      const run = createSchedulerRun("sched-e2", "api");
      createSchedulerTaskRun(run.id, "task-e2-1");
      createSchedulerTaskRun(run.id, "task-e2-2");
      createSchedulerTaskRun(run.id, "task-e2-3");

      await runUnifiedSchedulerEngineTickForTests();

      const taskRuns = getSchedulerTaskRunsForRun(run.id);
      expect(taskRuns).toHaveLength(3);

      // This is the core regression assertion: before the fix, B and C were always
      // skipped because the in-memory dependency map was never refreshed after A ran.
      expect(taskRuns[0].status).toBe("success"); // Step A
      expect(taskRuns[1].status).toBe("success"); // Step B (depends on A)
      expect(taskRuns[2].status).toBe("success"); // Step C (depends on B)
    }
  );

  test(
    "failure cascade: when step A fails, steps B and C are skipped with dependency reason in logs",
    async () => {
      insertSchedule("sched-e3", "Failure Cascade Test");
      // unsupported.handler.test throws "Unsupported scheduler handler" → step A fails.
      insertTask("task-e3-1", "sched-e3", "step_a", "Step A (fails)", "unsupported.handler.test", 0, null);
      insertTask("task-e3-2", "sched-e3", "step_b", "Step B", "system.db_maintenance.run_due", 1, "task-e3-1");
      insertTask("task-e3-3", "sched-e3", "step_c", "Step C", "system.db_maintenance.run_due", 2, "task-e3-2");

      const run = createSchedulerRun("sched-e3", "api");
      createSchedulerTaskRun(run.id, "task-e3-1");
      createSchedulerTaskRun(run.id, "task-e3-2");
      createSchedulerTaskRun(run.id, "task-e3-3");

      await runUnifiedSchedulerEngineTickForTests();

      const taskRuns = getSchedulerTaskRunsForRun(run.id);
      expect(taskRuns).toHaveLength(3);
      expect(taskRuns[0].status).toBe("failed");  // Step A: unsupported handler
      expect(taskRuns[1].status).toBe("skipped"); // Step B: A failed
      expect(taskRuns[2].status).toBe("skipped"); // Step C: B skipped

      // Error messages must explain WHY each step was skipped.
      expect(taskRuns[1].error_message).toContain('"failed"');
      expect(taskRuns[1].error_message).toContain('expected "success"');
      expect(taskRuns[2].error_message).toContain('"skipped"');
      expect(taskRuns[2].error_message).toContain('expected "success"');

      // Log messages for warning-level skip entries.
      const warnLogs = logsForRun(run.id).filter((l) => l.level === "warning");
      expect(warnLogs.length).toBeGreaterThanOrEqual(2);
      expect(warnLogs.some((l) => l.message.includes("step_b"))).toBe(true);
      expect(warnLogs.some((l) => l.message.includes("step_c"))).toBe(true);
    }
  );

  test("independent tasks with no dependencies both run regardless of order", async () => {
    insertSchedule("sched-e4", "Independent Tasks Test");
    insertTask("task-e4-1", "sched-e4", "task_a", "Task A", "system.db_maintenance.run_due", 0, null);
    insertTask("task-e4-2", "sched-e4", "task_b", "Task B", "system.db_maintenance.run_due", 1, null);

    const run = createSchedulerRun("sched-e4", "api");
    createSchedulerTaskRun(run.id, "task-e4-1");
    createSchedulerTaskRun(run.id, "task-e4-2");

    await runUnifiedSchedulerEngineTickForTests();

    const taskRuns = getSchedulerTaskRunsForRun(run.id);
    expect(taskRuns).toHaveLength(2);
    expect(taskRuns[0].status).toBe("success");
    expect(taskRuns[1].status).toBe("success");
  });
});

describe("scheduler engine: job scout pipeline", () => {
  beforeEach(() => {
    (runAgentLoop as jest.Mock).mockClear();
    (runAgentLoop as jest.Mock).mockResolvedValue({
      content: "Mock agent response",
      toolsUsed: 2,
      pendingApprovals: [],
    });
  });

  test("all three steps execute via the agent loop and share a single pipeline thread", async () => {
    insertSchedule("sched-e5", "Job Scout Pipeline", "workflow.job_scout");
    insertTask("task-e5-1", "sched-e5", "search",  "Search Listings",     "workflow.job_scout.search",  0, null);
    insertTask("task-e5-2", "sched-e5", "extract", "Extract Role Details", "workflow.job_scout.extract", 1, "task-e5-1");
    insertTask("task-e5-3", "sched-e5", "prepare", "Prepare Resume",       "workflow.job_scout.prepare", 2, "task-e5-2");

    const run = createSchedulerRun("sched-e5", "api");
    createSchedulerTaskRun(run.id, "task-e5-1");
    createSchedulerTaskRun(run.id, "task-e5-2");
    createSchedulerTaskRun(run.id, "task-e5-3");

    await runUnifiedSchedulerEngineTickForTests();

    const taskRuns = getSchedulerTaskRunsForRun(run.id);
    expect(taskRuns).toHaveLength(3);
    expect(taskRuns[0].status).toBe("success"); // search
    expect(taskRuns[1].status).toBe("success"); // extract (depends on search)
    expect(taskRuns[2].status).toBe("success"); // prepare (depends on extract)

    // All three steps must have called the agent loop.
    expect(runAgentLoop as jest.Mock).toHaveBeenCalledTimes(3);

    const calls = (runAgentLoop as jest.Mock).mock.calls as [string, string, ...unknown[]][];
    const threadIds = calls.map(([tid]) => tid);
    // All steps share the same conversation thread so context flows between them.
    expect(threadIds[0]).toBe(threadIds[1]);
    expect(threadIds[1]).toBe(threadIds[2]);

    // Each step receives a step-specific prompt (not a generic one).
    const prompts = calls.map(([, prompt]) => prompt.toLowerCase());
    expect(prompts[0]).toContain("search");
    expect(prompts[1]).toContain("extract");
    expect(prompts[2]).toContain("prepare");

    // Output JSON records the step key, thread id, and tool usage.
    const output0 = JSON.parse(taskRuns[0].output_json ?? "{}") as { kind: string; stepKey: string; threadId: string; toolsUsed: number };
    expect(output0.kind).toBe("job_scout_pipeline");
    expect(output0.stepKey).toBe("search");
    expect(output0.threadId).toBe(threadIds[0]);
    expect(output0.toolsUsed).toBe(2);
  });

  test("job scout step failure cascades: extract skipped when search fails", async () => {
    (runAgentLoop as jest.Mock).mockRejectedValueOnce(new Error("LLM timeout"));
    (runAgentLoop as jest.Mock).mockResolvedValue({ content: "ok", toolsUsed: 0, pendingApprovals: [] });

    insertSchedule("sched-e6", "Job Scout Failure Test", "workflow.job_scout");
    insertTask("task-e6-1", "sched-e6", "search",  "Search Listings",     "workflow.job_scout.search",  0, null);
    insertTask("task-e6-2", "sched-e6", "extract", "Extract Role Details", "workflow.job_scout.extract", 1, "task-e6-1");

    const run = createSchedulerRun("sched-e6", "api");
    createSchedulerTaskRun(run.id, "task-e6-1");
    createSchedulerTaskRun(run.id, "task-e6-2");

    await runUnifiedSchedulerEngineTickForTests();

    const taskRuns = getSchedulerTaskRunsForRun(run.id);
    expect(taskRuns[0].status).toBe("failed");  // search: LLM error
    expect(taskRuns[1].status).toBe("skipped"); // extract: search failed

    expect(taskRuns[1].error_message).toContain('"failed"');
  });

  test("custom prompt in config_json overrides the built-in step prompt", async () => {
    const customPrompt = "Custom search prompt for senior backend roles";
    insertSchedule("sched-e7", "Custom Prompt Test", "workflow.job_scout");
    insertTask(
      "task-e7-1", "sched-e7", "search", "Search Listings", "workflow.job_scout.search", 0, null,
      JSON.stringify({ prompt: customPrompt }),
    );

    const run = createSchedulerRun("sched-e7", "api");
    createSchedulerTaskRun(run.id, "task-e7-1");

    await runUnifiedSchedulerEngineTickForTests();

    const taskRuns = getSchedulerTaskRunsForRun(run.id);
    expect(taskRuns[0].status).toBe("success");

    const calls = (runAgentLoop as jest.Mock).mock.calls as [string, string, ...unknown[]][];
    expect(calls[0][1]).toBe(customPrompt);
  });
});

describe("scheduler engine: log detail quality", () => {
  test("execution logs include task name and handler before and after each task", async () => {
    insertSchedule("sched-e8", "Log Detail Test");
    insertTask("task-e8-1", "sched-e8", "maint_task", "Named Maintenance Task", "system.db_maintenance.run_due", 0);

    const run = createSchedulerRun("sched-e8", "api");
    createSchedulerTaskRun(run.id, "task-e8-1");

    await runUnifiedSchedulerEngineTickForTests();

    const msgs = logsForRun(run.id).map((l) => l.message);

    // Pre-execution log includes task name and task_key.
    expect(msgs.some((m) => m.includes("Named Maintenance Task") && m.includes("maint_task"))).toBe(true);
    // Pre-execution log includes the handler name.
    expect(msgs.some((m) => m.includes("system.db_maintenance.run_due"))).toBe(true);
    // Post-execution success log is present.
    expect(msgs.some((m) => m.includes("DB maintenance task completed"))).toBe(true);
    // Run-level completion log.
    expect(msgs.some((m) => m.includes("Scheduler run completed"))).toBe(true);
  });

  test("skipped task logs include the dependency id and its status", async () => {
    insertSchedule("sched-e9", "Skip Detail Log Test");
    insertTask("task-e9-1", "sched-e9", "step_a", "Step A (fails)", "unsupported.handler.test", 0, null);
    insertTask("task-e9-2", "sched-e9", "step_b", "Step B", "system.db_maintenance.run_due", 1, "task-e9-1");

    const run = createSchedulerRun("sched-e9", "api");
    createSchedulerTaskRun(run.id, "task-e9-1");
    createSchedulerTaskRun(run.id, "task-e9-2");

    await runUnifiedSchedulerEngineTickForTests();

    // The warning log for the skipped task must:
    //   - mention which task was skipped (step_b)
    //   - show the dependency status ("failed")
    const warnMsgs = logsForRun(run.id)
      .filter((l) => l.level === "warning")
      .map((l) => l.message);

    expect(warnMsgs.length).toBeGreaterThanOrEqual(1);
    expect(warnMsgs.some((m) => m.includes("step_b") && m.includes('"failed"'))).toBe(true);
  });
});
