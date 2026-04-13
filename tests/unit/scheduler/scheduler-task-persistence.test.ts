/**
 * Unit tests — Scheduler task persistence (#291)
 *
 * Validates:
 * - Scheduler-generated prompts ("Scheduled task: ...") are not re-parsed as
 *   new scheduled tasks (prevents recursive task accumulation)
 * - Non-interactive threads are still skipped
 * - config_json.prompt is stored with exactly one "Scheduled task: " prefix
 */

// ── Module-level mocks ─────────────────────────────────────────────────────

const mockGetThread = jest.fn();
const mockAddLog = jest.fn();
const mockUpsertSchedulerScheduleByKey = jest.fn();
const mockUpdateSchedulerTaskGraph = jest.fn();
const mockGetDb = jest.fn();

jest.mock("@/lib/db", () => ({
  getThread: (...args: unknown[]) => mockGetThread(...args),
  addLog: (...args: unknown[]) => mockAddLog(...args),
  upsertSchedulerScheduleByKey: (...args: unknown[]) => mockUpsertSchedulerScheduleByKey(...args),
  updateSchedulerTaskGraph: (...args: unknown[]) => mockUpdateSchedulerTaskGraph(...args),
  getDb: (...args: unknown[]) => mockGetDb(...args),
}));

jest.mock("@/lib/logging/logger", () => ({
  createLogger: () => ({
    enter: jest.fn(),
    exit: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock("@/lib/scheduler/task-parser", () => ({
  parseScheduledTasksFromUserMessage: jest.requireActual("@/lib/scheduler/task-parser").parseScheduledTasksFromUserMessage,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function setupInteractiveThread() {
  mockGetThread.mockReturnValue({ id: "thread-1", thread_type: "interactive" });
  mockGetDb.mockReturnValue({
    prepare: jest.fn().mockReturnValue({ get: jest.fn().mockReturnValue({ id: "sched-1" }) }),
  });
}

// ── Import AFTER mocks ──────────────────────────────────────────────────────
import { persistScheduledTasksFromMessage } from "@/lib/agent/scheduler-task-persistence";

// ── Tests ──────────────────────────────────────────────────────────────────

describe("persistScheduledTasksFromMessage — #291 recursive task guard", () => {
  const THREAD_ID = "thread-1";
  const USER_ID = "user-1";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("skips messages that start with 'Scheduled task:' to prevent recursive task creation", () => {
    setupInteractiveThread();

    persistScheduledTasksFromMessage(THREAD_ID, "Scheduled task: check disk usage every hour", USER_ID);

    expect(mockUpsertSchedulerScheduleByKey).not.toHaveBeenCalled();
    expect(mockUpdateSchedulerTaskGraph).not.toHaveBeenCalled();
  });

  test("skips case-insensitive 'SCHEDULED TASK:' prefix", () => {
    setupInteractiveThread();

    persistScheduledTasksFromMessage(THREAD_ID, "SCHEDULED TASK: send weekly summary", USER_ID);

    expect(mockUpsertSchedulerScheduleByKey).not.toHaveBeenCalled();
  });

  test("skips even if prefix is repeated (already-accumulated malformed prompt)", () => {
    setupInteractiveThread();

    const malformed = "Scheduled task: Scheduled task: Scheduled task: do something daily";
    persistScheduledTasksFromMessage(THREAD_ID, malformed, USER_ID);

    expect(mockUpsertSchedulerScheduleByKey).not.toHaveBeenCalled();
  });

  test("does NOT skip a normal user message containing the word 'schedule'", () => {
    setupInteractiveThread();
    mockUpsertSchedulerScheduleByKey.mockReturnValue(undefined);
    mockUpdateSchedulerTaskGraph.mockReturnValue(undefined);

    persistScheduledTasksFromMessage(
      THREAD_ID,
      "Schedule a daily reminder to check job listings",
      USER_ID,
    );

    // Should proceed and attempt to create the task
    expect(mockUpsertSchedulerScheduleByKey).toHaveBeenCalledTimes(1);
  });

  test("config_json.prompt has exactly one 'Scheduled task: ' prefix on new task creation", () => {
    setupInteractiveThread();
    mockUpsertSchedulerScheduleByKey.mockReturnValue(undefined);
    mockUpdateSchedulerTaskGraph.mockReturnValue(undefined);

    persistScheduledTasksFromMessage(
      THREAD_ID,
      "Remind me daily to review the agent logs",
      USER_ID,
    );

    expect(mockUpdateSchedulerTaskGraph).toHaveBeenCalledTimes(1);
    const [, tasks] = mockUpdateSchedulerTaskGraph.mock.calls[0] as [string, Array<{ config_json: string }>];
    const parsedConfig = JSON.parse(tasks[0].config_json);

    // Exactly one prefix — not "Scheduled task: Scheduled task: ..."
    expect(parsedConfig.prompt).toMatch(/^Scheduled task: /);
    const prefixCount = (parsedConfig.prompt.match(/Scheduled task:/gi) || []).length;
    expect(prefixCount).toBe(1);
  });

  test("skips when thread is not interactive", () => {
    mockGetThread.mockReturnValue({ id: THREAD_ID, thread_type: "scheduled" });

    persistScheduledTasksFromMessage(THREAD_ID, "Remind me daily to check logs", USER_ID);

    expect(mockUpsertSchedulerScheduleByKey).not.toHaveBeenCalled();
  });

  test("skips when userId is missing", () => {
    persistScheduledTasksFromMessage(THREAD_ID, "Remind me daily to check logs", undefined);

    expect(mockGetThread).not.toHaveBeenCalled();
    expect(mockUpsertSchedulerScheduleByKey).not.toHaveBeenCalled();
  });
});
