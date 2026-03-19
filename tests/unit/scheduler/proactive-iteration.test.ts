/**
 * Unit tests — ProactiveBatchJob iterative exploration loop (#183)
 *
 * Tests the stopping conditions, tool accumulation, and iteration
 * breakdown returned by runProactiveScanInner (exercised via executeStep).
 */

// ── Mocks ────────────────────────────────────────────────────────────

const mockAddLog = jest.fn();
const mockCreateThread = jest.fn();
const mockGetAppConfig = jest.fn();
const mockSetAppConfig = jest.fn();
const mockGetToolPolicy = jest.fn();
const mockGetCustomToolDefinitions = jest.fn(() => []);
const mockGetDefaultAdminUserId = jest.fn(() => "admin-user");
const mockSetSchedulerTaskRunStatus = jest.fn();

jest.mock("@/lib/db", () => ({
  addLog: (...args: unknown[]) => mockAddLog(...args),
  createThread: (...args: unknown[]) => mockCreateThread(...args),
  getAppConfig: (...args: unknown[]) => mockGetAppConfig(...args),
  setAppConfig: (...args: unknown[]) => mockSetAppConfig(...args),
  getToolPolicy: (...args: unknown[]) => mockGetToolPolicy(...args),
  setSchedulerTaskRunStatus: (...args: unknown[]) => mockSetSchedulerTaskRunStatus(...args),
}));

jest.mock("@/lib/tools/custom-tools", () => ({
  getCustomToolDefinitions: () => mockGetCustomToolDefinitions(),
}));

jest.mock("@/lib/scheduler/shared", () => ({
  getDefaultAdminUserId: () => mockGetDefaultAdminUserId(),
  mergeBatchContext: (_a: unknown, _b: unknown) => ({}),
}));

const mockOrchestratorRun = jest.fn();
jest.mock("@/lib/agent/multi-agent", () => ({
  OrchestratorAgent: jest.fn().mockImplementation(() => ({
    run: mockOrchestratorRun,
  })),
  AgentRegistry: {
    getInstance: jest.fn().mockReturnValue({}),
  },
}));

const mockGetConnectedServerIds = jest.fn(() => ["home-assistant"]);
const mockGetAllTools = jest.fn(() => [
  { name: "hass.list_entities" },
  { name: "hass.get_state" },
  { name: "net_scan_network" },
  { name: "camera.list" },
]);

jest.mock("@/lib/mcp", () => ({
  getMcpManager: () => ({
    getConnectedServerIds: () => mockGetConnectedServerIds(),
    getAllTools: () => mockGetAllTools(),
  }),
}));

jest.mock("@/lib/prompts", () => ({
  buildProactiveScanMessagePrompt: jest.fn(() => "[mock primary scan context]"),
  buildExplorationFollowupMessagePrompt: jest.fn(() => "[mock followup context]"),
  PROACTIVE_PRIMARY_TASK_PROMPT: "Perform a proactive scan.",
  PROACTIVE_FOLLOWUP_TASK_PROMPT: "Perform a targeted exploration pass.",
}));

// ── Helpers ──────────────────────────────────────────────────────────

function makeStepCtx(configJson: Record<string, unknown> = {}) {
  return {
    scheduleId: "sched-1",
    runId: "run-1",
    taskRunId: "task-1",
    handlerName: "system.proactive.scan",
    configJson: JSON.stringify(configJson),
    pipelineThreadId: undefined,
  };
}

function makeOrchestratorResult(toolsUsed: string[], response = "Done.") {
  return { response, toolsUsed, agentsDispatched: [] };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("ProactiveBatchJob — iterative exploration loop", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // mockResolvedValueOnce queues are NOT cleared by clearAllMocks — reset explicitly
    mockOrchestratorRun.mockReset();
    mockGetAppConfig.mockReturnValue(null); // no prior tools
    // Return null for toolmaker tools so requireToolmakerAction stays false in most tests
    mockGetToolPolicy.mockImplementation((name: string) => {
      if (name === "nexus_create_tool" || name === "nexus_update_tool") return null;
      return { requires_approval: 0 };
    });

    let threadCount = 0;
    mockCreateThread.mockImplementation(() => ({
      id: `thread-${++threadCount}`,
    }));
  });

  test("stops after iteration 1 when coverage goals are met", async () => {
    // Tools cover novelty (new tools vs lastToolsUsed=[]), depth (network), no toolmaker needed
    mockOrchestratorRun.mockResolvedValueOnce(
      makeOrchestratorResult(["hass.list_entities", "net_scan_network", "camera.list"])
    );

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    const result = await job.executeStep(makeStepCtx({ scanIterations: 3 }), jest.fn());

    const output = result.outputJson as { iterationCount: number; iterations: { stopReason: string }[] };
    expect(output.iterationCount).toBe(1);
    expect(output.iterations[0].stopReason).toBe("coverage_met");
    expect(mockOrchestratorRun).toHaveBeenCalledTimes(1);
  });

  test("stops after iteration 2 on stagnation (no new tools)", async () => {
    // Iteration 1: uses tool A
    mockOrchestratorRun.mockResolvedValueOnce(makeOrchestratorResult(["hass.list_entities"]));
    // Iteration 2: uses same tool A — no new tools → stagnation
    mockOrchestratorRun.mockResolvedValueOnce(makeOrchestratorResult(["hass.list_entities"]));

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    const result = await job.executeStep(makeStepCtx({ scanIterations: 5 }), jest.fn());

    const output = result.outputJson as { iterationCount: number; iterations: { stopReason?: string }[] };
    expect(output.iterationCount).toBe(2);
    expect(output.iterations[1].stopReason).toBe("stagnation");
    expect(mockOrchestratorRun).toHaveBeenCalledTimes(2);
  });

  test("runs up to max scan iterations when coverage never fully met", async () => {
    // Each iteration uses a new tool but never achieves full coverage
    mockOrchestratorRun.mockResolvedValueOnce(makeOrchestratorResult(["hass.list_entities"]));
    mockOrchestratorRun.mockResolvedValueOnce(makeOrchestratorResult(["hass.get_state"]));

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    const result = await job.executeStep(makeStepCtx({ scanIterations: 2 }), jest.fn());

    const output = result.outputJson as { iterationCount: number; iterations: { stopReason?: string }[] };
    expect(output.iterationCount).toBe(2);
    expect(output.iterations[1].stopReason).toBe("max_iterations");
    expect(mockOrchestratorRun).toHaveBeenCalledTimes(2);
  });

  test("accumulates tools from all iterations (deduplicated)", async () => {
    mockOrchestratorRun.mockResolvedValueOnce(makeOrchestratorResult(["hass.list_entities", "hass.get_state"]));
    mockOrchestratorRun.mockResolvedValueOnce(makeOrchestratorResult(["hass.get_state", "net_scan_network"]));

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    const result = await job.executeStep(makeStepCtx({ scanIterations: 2 }), jest.fn());

    const output = result.outputJson as { toolsUsed: string[]; iterations: { newToolsCount: number }[] };
    // All 3 distinct tools accumulated
    expect(output.toolsUsed).toHaveLength(3);
    expect(output.toolsUsed).toContain("hass.list_entities");
    expect(output.toolsUsed).toContain("hass.get_state");
    expect(output.toolsUsed).toContain("net_scan_network");
    // Iteration 2 only counted 1 new tool (net_scan_network)
    expect(output.iterations[1].newToolsCount).toBe(1);
  });

  test("primaryThreadId is from first iteration, followupThreadId from last", async () => {
    mockOrchestratorRun.mockResolvedValueOnce(makeOrchestratorResult(["hass.list_entities"]));
    mockOrchestratorRun.mockResolvedValueOnce(makeOrchestratorResult(["net_scan_network", "camera.list"]));

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    const result = await job.executeStep(makeStepCtx({ scanIterations: 2 }), jest.fn());

    const output = result.outputJson as { primaryThreadId: string; followupThreadId?: string; iterationCount: number };
    expect(output.primaryThreadId).toBe("thread-1");
    expect(output.followupThreadId).toBe("thread-2");
    expect(output.iterationCount).toBe(2);
  });

  test("single iteration scan has no followupThreadId", async () => {
    mockOrchestratorRun.mockResolvedValueOnce(
      makeOrchestratorResult(["hass.list_entities", "net_scan_network", "camera.list"])
    );

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    const result = await job.executeStep(makeStepCtx({ scanIterations: 3 }), jest.fn());

    const output = result.outputJson as { followupThreadId?: string };
    expect(output.followupThreadId).toBeUndefined();
  });

  test("persists accumulated tools to app config after scan", async () => {
    mockOrchestratorRun.mockResolvedValueOnce(makeOrchestratorResult(["hass.list_entities", "net_scan_network"]));

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    await job.executeStep(makeStepCtx({ scanIterations: 1 }), jest.fn());

    expect(mockSetAppConfig).toHaveBeenCalledWith(
      "proactive_last_tools",
      expect.stringContaining("hass.list_entities")
    );
  });

  test("defaults to 3 scan iterations when not configured", async () => {
    // Provide enough mock results for up to 3 iterations, each with a new tool
    mockOrchestratorRun.mockResolvedValueOnce(makeOrchestratorResult(["tool-a"]));
    mockOrchestratorRun.mockResolvedValueOnce(makeOrchestratorResult(["tool-b"]));
    mockOrchestratorRun.mockResolvedValueOnce(makeOrchestratorResult(["tool-c"]));

    const { ProactiveBatchJob } = await import("@/lib/scheduler/batch-jobs/proactive");
    const job = new ProactiveBatchJob();
    // No scanIterations in config → defaults to 3
    await job.executeStep(makeStepCtx({}), jest.fn());

    expect(mockOrchestratorRun).toHaveBeenCalledTimes(3);
  });
});
