/**
 * Unit tests — ProactiveBatchJob circuit-breaker for 401/403 auth failures (#292)
 *
 * Validates:
 * - After 3 consecutive auth-failure scans, schedule is paused and user is notified
 * - Counter resets on a successful scan (no auth errors)
 * - Circuit-breaker short-circuits execution once threshold is reached
 * - Auth failure detection reads from messages.role='tool' content
 */

// ── Mocks ────────────────────────────────────────────────────────────

const mockAddLog = jest.fn();
const mockCreateThread = jest.fn();
const mockGetAppConfig = jest.fn();
const mockSetAppConfig = jest.fn();
const mockGetToolPolicy = jest.fn();
const mockGetDb = jest.fn();

jest.mock("@/lib/db", () => ({
  addLog: (...args: unknown[]) => mockAddLog(...args),
  createThread: (...args: unknown[]) => mockCreateThread(...args),
  getAppConfig: (...args: unknown[]) => mockGetAppConfig(...args),
  setAppConfig: (...args: unknown[]) => mockSetAppConfig(...args),
  getToolPolicy: (...args: unknown[]) => mockGetToolPolicy(...args),
  getDb: () => mockGetDb(),
}));

const mockUpdateSchedulerScheduleById = jest.fn();
const mockGetSchedulerScheduleById = jest.fn();
jest.mock("@/lib/db/scheduler-queries", () => ({
  updateSchedulerScheduleById: (...args: unknown[]) => mockUpdateSchedulerScheduleById(...args),
  getSchedulerScheduleById: (...args: unknown[]) => mockGetSchedulerScheduleById(...args),
}));

const mockCreateNotification = jest.fn();
jest.mock("@/lib/db/notification-queries", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

jest.mock("@/lib/tools/custom-tools", () => ({
  getCustomToolDefinitions: jest.fn(() => []),
}));

jest.mock("@/lib/scheduler/shared", () => ({
  getDefaultAdminUserId: jest.fn(() => "admin-user"),
  mergeBatchContext: (_a: unknown, _b: unknown) => ({}),
}));

const mockOrchestratorRun = jest.fn();
jest.mock("@/lib/agent/multi-agent", () => ({
  OrchestratorAgent: jest.fn().mockImplementation(() => ({ run: mockOrchestratorRun })),
  AgentRegistry: { getInstance: jest.fn().mockReturnValue({}) },
}));

jest.mock("@/lib/mcp", () => ({
  getMcpManager: () => ({
    getConnectedServerIds: jest.fn(() => []),
    getAllTools: jest.fn(() => [{ name: "hass.list_entities" }]),
  }),
}));

jest.mock("@/lib/prompts", () => ({
  buildProactiveScanMessagePrompt: jest.fn(() => "[context]"),
  buildExplorationFollowupMessagePrompt: jest.fn(() => "[followup]"),
  PROACTIVE_PRIMARY_TASK_PROMPT: "Scan.",
  PROACTIVE_FOLLOWUP_TASK_PROMPT: "Follow up.",
}));

// ── Helpers ──────────────────────────────────────────────────────────

function makeStepCtx() {
  return {
    scheduleId: "sched-proactive-1",
    runId: "run-1",
    taskRunId: "task-1",
    handlerName: "system.proactive.scan",
    configJson: JSON.stringify({ scanIterations: 1 }),
    pipelineThreadId: undefined,
  };
}

/** DB mock: messages table returns a 401 tool result. */
function mockDbWith401() {
  mockGetDb.mockReturnValue({
    prepare: jest.fn().mockReturnValue({
      all: jest.fn().mockReturnValue([
        { content: "Fetch failed: 401 HTTP Forbidden" },
      ]),
    }),
  });
}

/** DB mock: messages table returns no auth errors. */
function mockDbNoAuthErrors() {
  mockGetDb.mockReturnValue({
    prepare: jest.fn().mockReturnValue({
      all: jest.fn().mockReturnValue([
        { content: '{"result": "ok"}' },
      ]),
    }),
  });
}

let threadCount = 0;

// ── Tests ────────────────────────────────────────────────────────────

describe("ProactiveBatchJob — circuit-breaker (#292)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrchestratorRun.mockReset();
    threadCount = 0;
    mockCreateThread.mockImplementation(() => ({ id: `thread-${++threadCount}` }));
    mockGetToolPolicy.mockReturnValue(null);
    // Default: no prior failures
    mockGetAppConfig.mockReturnValue(null);
    // Default: schedule has an owner
    mockGetSchedulerScheduleById.mockReturnValue({ id: "sched-proactive-1", owner_id: "admin-user" });
  });

  test("increments counter on first auth failure and does NOT pause yet", async () => {
    mockGetAppConfig.mockReturnValue("0"); // 0 prior failures
    mockDbWith401();
    mockOrchestratorRun.mockResolvedValueOnce({ response: "done", toolsUsed: ["builtin.web_fetch"], agentsDispatched: [] });

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    const logFn = jest.fn();
    await job.executeStep(makeStepCtx(), logFn);

    // Counter should be incremented to 1
    expect(mockSetAppConfig).toHaveBeenCalledWith("proactive_scan_consecutive_auth_failures", "1");
    // Schedule NOT paused yet (threshold not reached)
    expect(mockUpdateSchedulerScheduleById).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  test("pauses schedule and notifies user on 3rd consecutive failure", async () => {
    mockGetAppConfig.mockReturnValue("2"); // 2 prior failures
    mockDbWith401();
    mockOrchestratorRun.mockResolvedValueOnce({ response: "done", toolsUsed: ["builtin.web_fetch"], agentsDispatched: [] });

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    await job.executeStep(makeStepCtx(), jest.fn());

    // Counter incremented to 3
    expect(mockSetAppConfig).toHaveBeenCalledWith("proactive_scan_consecutive_auth_failures", "3");
    // Schedule paused
    expect(mockUpdateSchedulerScheduleById).toHaveBeenCalledWith(
      "sched-proactive-1",
      { status: "paused" }
    );
    // Warning logged
    const warnLog = mockAddLog.mock.calls.find((c) => c[0]?.level === "warning" && /auto-paused/i.test(c[0]?.message));
    expect(warnLog).toBeDefined();
    // Notification sent
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "admin-user", type: "warning" })
    );
  });

  test("circuit-breaker short-circuits execution when threshold already reached", async () => {
    mockGetAppConfig.mockReturnValue("3"); // already at threshold

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    const logFn = jest.fn();
    const result = await job.executeStep(makeStepCtx(), logFn);

    // Should skip without running the scan
    expect(mockOrchestratorRun).not.toHaveBeenCalled();
    const output = result.outputJson as { skipped?: boolean; circuitBreakerOpen?: boolean };
    expect(output.skipped).toBe(true);
    expect(output.circuitBreakerOpen).toBe(true);
    // Logged as warning
    const [call] = logFn.mock.calls.filter((c) => c[0] === "warning");
    expect(call).toBeDefined();
  });

  test("resets counter to 0 when a scan completes without auth errors", async () => {
    mockGetAppConfig.mockReturnValue("1"); // 1 prior failure
    mockDbNoAuthErrors();
    mockOrchestratorRun.mockResolvedValueOnce({ response: "done", toolsUsed: ["hass.list_entities"], agentsDispatched: [] });

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    await job.executeStep(makeStepCtx(), jest.fn());

    // Counter reset to 0
    expect(mockSetAppConfig).toHaveBeenCalledWith("proactive_scan_consecutive_auth_failures", "0");
    // No pause, no notification
    expect(mockUpdateSchedulerScheduleById).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  test("detects 403 Forbidden in addition to 401 Unauthorized", async () => {
    mockGetAppConfig.mockReturnValue("2"); // 2 prior failures
    mockGetDb.mockReturnValue({
      prepare: jest.fn().mockReturnValue({
        all: jest.fn().mockReturnValue([
          { content: "Fetch failed: 403 Forbidden" },
        ]),
      }),
    });
    mockOrchestratorRun.mockResolvedValueOnce({ response: "done", toolsUsed: ["builtin.web_fetch"], agentsDispatched: [] });

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    await job.executeStep(makeStepCtx(), jest.fn());

    // Should also detect 403 and reach threshold (2+1=3)
    expect(mockUpdateSchedulerScheduleById).toHaveBeenCalledWith(
      "sched-proactive-1",
      { status: "paused" }
    );
  });

  test("does NOT increment counter when DB query fails (defensive)", async () => {
    mockGetAppConfig.mockReturnValue("0");
    // DB throws
    mockGetDb.mockReturnValue({
      prepare: jest.fn().mockReturnValue({
        all: jest.fn().mockImplementation(() => { throw new Error("DB BUSY"); }),
      }),
    });
    mockOrchestratorRun.mockResolvedValueOnce({ response: "done", toolsUsed: ["hass.list_entities"], agentsDispatched: [] });

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    await expect(job.executeStep(makeStepCtx(), jest.fn())).resolves.not.toThrow();

    // Counter should be reset (scan had no auth errors per try/catch fallback)
    // setAppConfig should NOT be called since currentFailures is 0 and no auth failure detected
    const authFailureCalls = mockSetAppConfig.mock.calls.filter(
      (c) => c[0] === "proactive_scan_consecutive_auth_failures"
    );
    // Either reset to 0 (if called) or not called at all — but should not increment
    if (authFailureCalls.length > 0) {
      expect(authFailureCalls[0][1]).toBe("0");
    }
    expect(mockUpdateSchedulerScheduleById).not.toHaveBeenCalled();
  });
});
