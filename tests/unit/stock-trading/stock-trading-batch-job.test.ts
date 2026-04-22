/**
 * Unit tests — StockTradingBatchJob
 *
 * Validates:
 * - executeStep dispatches to orchestrator with correct context
 * - paper-mode guard: live config without env var falls back to paper
 * - missing userId throws a useful error
 * - createDefaultTasks returns well-shaped task descriptor
 * - handler routing (canExecuteHandler / getHandlerNames)
 */

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";

// ─── DB + schedule mock ────────────────────────────────────────────────────────

jest.mock("@/lib/db", () => ({
  createThread: jest.fn(() => ({ id: "thread-stock-1" })),
  getSchedulerScheduleById: jest.fn(() => ({
    id: "sched-1",
    owner_id: "user-test-id",
    name: "Stock Trading Pipeline",
  })),
}));

// ─── Orchestrator mock ────────────────────────────────────────────────────────

const mockOrchestratorRun = jest.fn().mockResolvedValue({
  response: "Cycle complete. 1 buy placed.",
  toolsUsed: ["alpaca_place_order"],
  agentsDispatched: ["stock-market-researcher", "stock-risk-manager", "stock-trade-executor"],
  threadId: "thread-stock-1",
});

jest.mock("@/lib/agent/multi-agent", () => ({
  OrchestratorAgent: jest.fn().mockImplementation(() => ({
    run: mockOrchestratorRun,
  })),
  AgentRegistry: {
    getInstance: jest.fn(() => ({ buildAgentSummary: () => "agents" })),
  },
}));

// ─── env mock ─────────────────────────────────────────────────────────────────

jest.mock("@/lib/env", () => ({
  env: {
    ALPACA_API_KEY: "test-key",
    ALPACA_API_SECRET: "test-secret",
    ALPACA_MODE: "paper",
  },
}));

import { StockTradingBatchJob } from "@/lib/scheduler/batch-jobs/stock-trading";
import type { StepExecutionContext } from "@/lib/scheduler/batch-jobs/base";

const mockLog = jest.fn();

function makeCtx(configJson: object = {}): StepExecutionContext {
  return {
    taskRunId: "task-run-1",
    runId: "run-1",
    handlerName: "workflow.stock_trading.run",
    configJson: JSON.stringify(configJson),
    scheduleId: "sched-1",
    pipelineThreadId: null,
  };
}

// ─── Handler routing ──────────────────────────────────────────────────────────

describe("StockTradingBatchJob — handler routing", () => {
  const job = new StockTradingBatchJob();

  it("canExecuteHandler returns true for workflow.stock_trading.run", () => {
    expect(job.canExecuteHandler("workflow.stock_trading.run")).toBe(true);
  });

  it("canExecuteHandler returns false for unrelated handler", () => {
    expect(job.canExecuteHandler("workflow.job_scout.run")).toBe(false);
  });

  it("getHandlerNames contains workflow.stock_trading.run", () => {
    expect(job.getHandlerNames()).toContain("workflow.stock_trading.run");
  });

  it("type is stock_trading", () => {
    expect(job.type).toBe("stock_trading");
  });
});

// ─── Parameter definitions ────────────────────────────────────────────────────

describe("StockTradingBatchJob — parameter definitions", () => {
  const job = new StockTradingBatchJob();

  it("exposes mode, maxPositionPct, stopLossPct, dailyLossCap, maxIterations", () => {
    const keys = job.getParameterDefinitions().map((p) => p.key);
    expect(keys).toContain("mode");
    expect(keys).toContain("maxPositionPct");
    expect(keys).toContain("stopLossPct");
    expect(keys).toContain("dailyLossCap");
    expect(keys).toContain("maxIterations");
  });

  it("mode defaults to paper", () => {
    const modeDef = job.getParameterDefinitions().find((p) => p.key === "mode");
    expect(modeDef?.defaultValue).toBe("paper");
  });
});

// ─── createDefaultTasks ───────────────────────────────────────────────────────

describe("StockTradingBatchJob — createDefaultTasks", () => {
  const job = new StockTradingBatchJob();

  it("returns exactly one task", () => {
    // Access via build() which calls createDefaultTasks internally
    const result = job.build({ trigger_type: "cron", trigger_expr: "45 14 * * 1-5" });
    expect(result.tasks).toHaveLength(1);
  });

  it("task has correct handler_name", () => {
    const result = job.build({ trigger_type: "cron", trigger_expr: "45 14 * * 1-5" });
    expect(result.tasks[0].handler_name).toBe("workflow.stock_trading.run");
  });

  it("task carries mode=paper by default", () => {
    const result = job.build({ trigger_type: "cron", trigger_expr: "45 14 * * 1-5" });
    const cfg = result.tasks[0].config_json as Record<string, unknown>;
    expect(cfg.mode).toBe("paper");
  });

  it("respects custom parameters", () => {
    const result = job.build({
      trigger_type: "cron",
      trigger_expr: "45 14 * * 1-5",
      parameters: { mode: "paper", maxPositionPct: "15", stopLossPct: "3", dailyLossCap: "5", maxIterations: "10" },
    });
    const cfg = result.tasks[0].config_json as Record<string, unknown>;
    expect(cfg.maxPositionPct).toBe(15);
    expect(cfg.stopLossPct).toBe(3);
    expect(cfg.dailyLossCap).toBe(5);
  });
});

// ─── executeStep ──────────────────────────────────────────────────────────────

describe("StockTradingBatchJob.executeStep()", () => {
  let db: ReturnType<typeof setupTestDb>;

  beforeEach(() => {
    db = setupTestDb();
    mockOrchestratorRun.mockClear();
    mockLog.mockClear();
  });

  afterEach(() => teardownTestDb());

  it("calls orchestrator.run with userId and additionalContext", async () => {
    const job = new StockTradingBatchJob();
    const result = await job.executeStep(
      makeCtx({ userId: "user-abc", mode: "paper", maxPositionPct: 20, stopLossPct: 5, dailyLossCap: 10 }),
      mockLog
    );
    expect(mockOrchestratorRun).toHaveBeenCalledTimes(1);
    const [, context] = mockOrchestratorRun.mock.calls[0] as [string, { userId: string; additionalContext: string }];
    expect(context.userId).toBe("user-abc");
    expect(context.additionalContext).toContain("Mode: paper");
    expect(result.outputJson?.kind).toBe("stock_trading_orchestrated");
  });

  it("falls back to schedule owner_id when userId not in config", async () => {
    const job = new StockTradingBatchJob();
    await job.executeStep(makeCtx({}), mockLog);
    const [, context] = mockOrchestratorRun.mock.calls[0] as [string, { userId: string }];
    expect(context.userId).toBe("user-test-id");
  });

  it("falls back to paper mode when config requests live but env is paper", async () => {
    const job = new StockTradingBatchJob();
    await job.executeStep(makeCtx({ userId: "u-1", mode: "live" }), mockLog);
    const logCalls = (mockLog as jest.Mock).mock.calls;
    const downgraded = logCalls.some(
      ([level, msg]: [string, string]) => level === "warning" && msg.includes("Falling back to paper")
    );
    expect(downgraded).toBe(true);
    const [, context] = mockOrchestratorRun.mock.calls[0] as [string, { additionalContext: string }];
    expect(context.additionalContext).toContain("Mode: paper");
  });

  it("throws when no userId can be resolved", async () => {
    const { getSchedulerScheduleById } = require("@/lib/db") as { getSchedulerScheduleById: jest.Mock };
    getSchedulerScheduleById.mockReturnValueOnce(null);
    const job = new StockTradingBatchJob();
    await expect(job.executeStep(makeCtx({}), mockLog)).rejects.toThrow("Missing userId");
  });

  it("returns pipelineThreadId in result", async () => {
    const job = new StockTradingBatchJob();
    const result = await job.executeStep(makeCtx({ userId: "u-1" }), mockLog);
    expect(result.pipelineThreadId).toBe("thread-stock-1");
  });
});
