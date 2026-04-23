/**
 * TradingBatchJob unit tests.
 *
 * Kraken HTTP calls are intercepted via fetch mock.
 * DB writes use the in-memory test DB.
 * The OrchestratorAgent is mocked so no LLM calls are made.
 */

jest.mock("@/lib/agent/multi-agent", () => ({
  OrchestratorAgent: jest.fn().mockImplementation(() => ({
    run: jest.fn().mockResolvedValue({
      threadId: "mock-thread",
      response:
        "Analysis complete.\n```json\n{\"recommendations\":[{\"pair\":\"XBTUSD\",\"side\":\"buy\",\"volume_usd\":20,\"score\":8,\"reasoning\":\"Strong momentum\"}],\"skip\":false,\"skip_reason\":null}\n```",
      agentsDispatched: 1,
      toolsUsed: ["web_search"],
    }),
  })),
  AgentRegistry: {
    getInstance: jest.fn().mockReturnValue({}),
  },
}));

jest.mock("@/lib/db", () => ({
  createThread: jest.fn().mockReturnValue({ id: "test-thread-id" }),
  getSchedulerScheduleById: jest.fn().mockReturnValue({ owner_id: "user-1", name: "Test Schedule" }),
}));

import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import { upsertUserIntegration, getTodayTrades } from "@/lib/db/user-trading-queries";
import { getDb } from "@/lib/db/connection";

const FAKE_KEY = "test-api-key";
const FAKE_SECRET = Buffer.from("test-secret-bytes-padded-here").toString("base64");

function insertTestUser(userId = "user-1") {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, email, display_name, provider_id, password_hash) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, `${userId}@test.com`, "Test User", "local", "hash");
}

function mockFetchSuccess(overrides: Record<string, unknown> = {}) {
  jest.spyOn(global, "fetch").mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/0/private/Balance")) {
      return Promise.resolve({ json: async () => ({ error: [], result: { ZUSD: "200.00" } }) } as Response);
    }
    if (u.includes("/0/public/Ticker")) {
      const tickerData: Record<string, unknown> = {
        XBTUSD: { a: ["65000", "1"], b: ["64999", "1"], c: ["65000", "1"], v: ["1", "100"], h: ["66000", "66000"], l: ["64000", "64000"] },
        ETHUSD: { a: ["3500", "1"], b: ["3499", "1"], c: ["3500", "1"], v: ["1", "200"], h: ["3600", "3600"], l: ["3400", "3400"] },
        SOLUSD: { a: ["180", "1"], b: ["179", "1"], c: ["180", "1"], v: ["1", "50"], h: ["190", "190"], l: ["170", "170"] },
        ADAUSD: { a: ["0.5", "1"], b: ["0.49", "1"], c: ["0.5", "1"], v: ["1", "100"], h: ["0.55", "0.55"], l: ["0.45", "0.45"] },
        XRPUSD: { a: ["0.6", "1"], b: ["0.59", "1"], c: ["0.6", "1"], v: ["1", "100"], h: ["0.65", "0.65"], l: ["0.55", "0.55"] },
      };
      return Promise.resolve({ json: async () => ({ error: [], result: tickerData }) } as Response);
    }
    if (u.includes("/0/public/OHLC")) {
      return Promise.resolve({ json: async () => ({ error: [], result: { XBTUSD: [], last: 0 } }) } as Response);
    }
    if (u.includes("/0/private/AddOrder")) {
      return Promise.resolve({ json: async () => ({ error: [], result: { txid: ["TXID123"], descr: { order: "buy 0.00030769 XBTUSD @ market" } } }) } as Response);
    }
    return Promise.resolve({ json: async () => ({ error: [], result: overrides }) } as Response);
  });
}

function makeCtx(handlerName: string, overrides: Partial<{ configJson: string; userId: string }> = {}) {
  return {
    taskRunId: "task-1",
    runId: "run-1",
    handlerName,
    configJson: overrides.configJson ?? JSON.stringify({ userId: "user-1" }),
    scheduleId: "sched-1",
    pipelineThreadId: "thread-1",
  };
}

const noopLog = jest.fn();

beforeEach(() => {
  setupTestDb();
  jest.clearAllMocks();
});

afterEach(() => {
  teardownTestDb();
  jest.restoreAllMocks();
});

// ─── Handler name registration ────────────────────────────────────────────────

describe("TradingBatchJob handler registration", () => {
  test("getHandlerNames returns both handlers", () => {
    const { TradingBatchJob } = require("@/lib/scheduler/batch-jobs/trading");
    const job = new TradingBatchJob();
    expect(job.getHandlerNames()).toContain("workflow.trading.run");
    expect(job.getHandlerNames()).toContain("workflow.trading.daily_summary");
  });

  test("canExecuteHandler returns true for both handlers", () => {
    const { TradingBatchJob } = require("@/lib/scheduler/batch-jobs/trading");
    const job = new TradingBatchJob();
    expect(job.canExecuteHandler("workflow.trading.run")).toBe(true);
    expect(job.canExecuteHandler("workflow.trading.daily_summary")).toBe(true);
  });

  test("canExecuteHandler returns false for unknown handler", () => {
    const { TradingBatchJob } = require("@/lib/scheduler/batch-jobs/trading");
    const job = new TradingBatchJob();
    expect(job.canExecuteHandler("workflow.job_scout.run")).toBe(false);
  });
});

// ─── No credentials ───────────────────────────────────────────────────────────

describe("TradingBatchJob.executeStep — no credentials", () => {
  test("returns skipped result when no integration configured", async () => {
    const { TradingBatchJob } = require("@/lib/scheduler/batch-jobs/trading");
    const job = new TradingBatchJob();
    const result = await job.executeStep(makeCtx("workflow.trading.run"), noopLog);
    expect(result.outputJson?.kind).toBe("trading_skipped");
    expect(result.outputJson?.reason).toBe("no_credentials");
  });
});

// ─── Balance too low ──────────────────────────────────────────────────────────

describe("TradingBatchJob.executeStep — balance too low", () => {
  test("stops and returns trading_stopped when balance < $10", async () => {
    insertTestUser();
    upsertUserIntegration("user-1", "kraken", FAKE_KEY, FAKE_SECRET);
    jest.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve({ json: async () => ({ error: [], result: { ZUSD: "5.00" } }) } as Response)
    );

    const { TradingBatchJob } = require("@/lib/scheduler/batch-jobs/trading");
    const job = new TradingBatchJob();
    const result = await job.executeStep(makeCtx("workflow.trading.run"), noopLog);
    expect(result.outputJson?.kind).toBe("trading_stopped");
    expect(result.outputJson?.reason).toBe("balance_too_low");
  });
});

// ─── Successful trading cycle ─────────────────────────────────────────────────

describe("TradingBatchJob.executeStep — successful cycle", () => {
  test("executes trade and logs it when orchestrator recommends a buy", async () => {
    insertTestUser();
    upsertUserIntegration("user-1", "kraken", FAKE_KEY, FAKE_SECRET);
    mockFetchSuccess();

    const { TradingBatchJob } = require("@/lib/scheduler/batch-jobs/trading");
    const job = new TradingBatchJob();
    const result = await job.executeStep(makeCtx("workflow.trading.run"), noopLog);

    expect(result.outputJson?.kind).toBe("trading_cycle");
    expect(result.outputJson?.skipped).toBe(false);
    expect(result.outputJson?.tradesExecuted).toBe(1);

    const trades = getTodayTrades("user-1", "kraken");
    expect(trades.length).toBeGreaterThan(0);
    const trade = trades[0];
    expect(trade.pair).toBe("XBTUSD");
    expect(trade.side).toBe("buy");
    expect(trade.status).toBe("filled");
    expect(trade.reasoning).toBe("Strong momentum");
  });
});

// ─── Daily summary ────────────────────────────────────────────────────────────

describe("TradingBatchJob.executeStep — daily summary", () => {
  test("runs orchestrator and returns trade count", async () => {
    insertTestUser();
    upsertUserIntegration("user-1", "kraken", FAKE_KEY, FAKE_SECRET);
    jest.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve({ json: async () => ({ error: [], result: { ZUSD: "200.00" } }) } as Response)
    );

    const { TradingBatchJob } = require("@/lib/scheduler/batch-jobs/trading");
    const job = new TradingBatchJob();
    const result = await job.executeStep(makeCtx("workflow.trading.daily_summary"), noopLog);

    expect(result.outputJson?.kind).toBe("trading_daily_summary");
    expect(typeof result.outputJson?.tradeCount).toBe("number");
  });
});

// ─── Skip scenario ────────────────────────────────────────────────────────────

describe("TradingBatchJob.executeStep — orchestrator skips", () => {
  test("returns skipped=true when orchestrator sets skip=true", async () => {
    insertTestUser();
    upsertUserIntegration("user-1", "kraken", FAKE_KEY, FAKE_SECRET);
    mockFetchSuccess();

    const { OrchestratorAgent } = require("@/lib/agent/multi-agent");
    (OrchestratorAgent as jest.Mock).mockImplementationOnce(() => ({
      run: jest.fn().mockResolvedValue({
        threadId: "mock-thread",
        response: "No good opportunities.\n```json\n{\"recommendations\":[],\"skip\":true,\"skip_reason\":\"No pair scored ≥ 7\"}\n```",
        agentsDispatched: 0,
        toolsUsed: [],
      }),
    }));

    const { TradingBatchJob } = require("@/lib/scheduler/batch-jobs/trading");
    const job = new TradingBatchJob();
    const result = await job.executeStep(makeCtx("workflow.trading.run"), noopLog);

    expect(result.outputJson?.kind).toBe("trading_cycle");
    expect(result.outputJson?.skipped).toBe(true);
    expect(result.outputJson?.reason).toContain("No pair scored");
  });
});
