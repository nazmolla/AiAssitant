import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  createScheduledTask,
  listDueScheduledTasks,
  updateScheduledTaskAfterRun,
  markScheduledTaskFailed,
} from "@/lib/db/queries";

describe("scheduled_tasks queries", () => {
  let userId: string;

  beforeAll(() => {
    setupTestDb();
    userId = seedTestUser({ email: "task-user@test.com", role: "user" });
  });

  afterAll(() => {
    teardownTestDb();
  });

  test("creates and returns due tasks", () => {
    createScheduledTask({
      userId,
      taskName: "Pay utility bill",
      frequency: "once",
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
      taskPayload: JSON.stringify({ kind: "agent_prompt", prompt: "Pay utility bill" }),
    });

    const due = listDueScheduledTasks(10);
    expect(due.length).toBeGreaterThanOrEqual(1);
    expect(due[0].task_name).toBe("Pay utility bill");
  });

  test("updates run metadata and completion", () => {
    const task = createScheduledTask({
      userId,
      taskName: "Daily backup check",
      frequency: "daily",
      intervalValue: 1,
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
      taskPayload: JSON.stringify({ kind: "agent_prompt", prompt: "Check backup status" }),
    });

    updateScheduledTaskAfterRun(task.id, {
      status: "active",
      nextRunAt: new Date(Date.now() + 86_400_000).toISOString(),
      lastError: null,
    });

    const due = listDueScheduledTasks(100);
    const found = due.find((t) => t.id === task.id);
    expect(found).toBeUndefined();
  });

  test("marks task as failed", () => {
    const task = createScheduledTask({
      userId,
      taskName: "Failing task",
      frequency: "once",
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
      taskPayload: JSON.stringify({ kind: "agent_prompt", prompt: "Failing task" }),
    });

    markScheduledTaskFailed(task.id, "boom");

    const due = listDueScheduledTasks(100);
    const found = due.find((t) => t.id === task.id);
    expect(found).toBeUndefined();
  });

  test("does not return future tasks as due", () => {
    createScheduledTask({
      userId,
      taskName: "Future task",
      frequency: "once",
      nextRunAt: new Date(Date.now() + 86_400_000).toISOString(),
      taskPayload: JSON.stringify({ kind: "agent_prompt", prompt: "Future task" }),
    });

    const due = listDueScheduledTasks(100);
    const found = due.find((t) => t.task_name === "Future task");
    expect(found).toBeUndefined();
  });

  test("creates task with recurring frequency and interval", () => {
    const task = createScheduledTask({
      userId,
      taskName: "Hourly health check",
      frequency: "hourly",
      intervalValue: 2,
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
      taskPayload: JSON.stringify({ kind: "agent_prompt", prompt: "Run health check" }),
    });

    expect(task.frequency).toBe("hourly");
    expect(task.interval_value).toBe(2);
    expect(task.status).toBe("active");
    expect(task.run_count).toBe(0);
  });
});
