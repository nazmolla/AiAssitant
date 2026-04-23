/**
 * Unit tests for KrakenTools (the agent tool category).
 *
 * Kraken HTTP calls are mocked via fetch spy.
 * DB uses the in-memory test DB.
 * Credentials are seeded with upsertUserIntegration().
 */

import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import { upsertUserIntegration } from "@/lib/db/user-trading-queries";
import { getDb } from "@/lib/db/connection";
import { KrakenTools, KRAKEN_TOOL_NAMES, KRAKEN_TOOLS_REQUIRING_APPROVAL, isKrakenTool } from "@/lib/tools/kraken-tools";

const FAKE_KEY = "test-api-key";
const FAKE_SECRET = Buffer.from("test-secret-for-kraken-tools").toString("base64");

function insertTestUser(userId = "user-1") {
  getDb().prepare(
    `INSERT OR IGNORE INTO users (id, email, display_name, provider_id, password_hash) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, `${userId}@test.com`, "Test User", "local", "hash");
}

function makeCtx(userId = "user-1") {
  return { threadId: "t1", userId };
}

function mockFetch(urlResponses: Record<string, unknown>) {
  return jest.spyOn(global, "fetch").mockImplementation((url) => {
    const u = String(url);
    for (const [pattern, body] of Object.entries(urlResponses)) {
      if (u.includes(pattern)) {
        return Promise.resolve({ json: async () => ({ error: [], result: body }) } as Response);
      }
    }
    return Promise.resolve({ json: async () => ({ error: [], result: {} }) } as Response);
  });
}

beforeEach(() => {
  setupTestDb();
  insertTestUser();
  upsertUserIntegration("user-1", "kraken", FAKE_KEY, FAKE_SECRET);
});

afterEach(() => {
  teardownTestDb();
  jest.restoreAllMocks();
});

// ─── Tool metadata ────────────────────────────────────────────────────────────

describe("KrakenTools metadata", () => {
  test("toolNamePrefix matches all tool names", () => {
    const kt = new KrakenTools();
    for (const name of Object.values(KRAKEN_TOOL_NAMES)) {
      expect(kt.matches(name)).toBe(true);
    }
  });

  test("does not match unrelated tools", () => {
    const kt = new KrakenTools();
    expect(kt.matches("builtin.channel_send")).toBe(false);
    expect(kt.matches("builtin.web_search")).toBe(false);
  });

  test("place_order and cancel_order require approval", () => {
    expect(KRAKEN_TOOLS_REQUIRING_APPROVAL).toContain(KRAKEN_TOOL_NAMES.PLACE_ORDER);
    expect(KRAKEN_TOOLS_REQUIRING_APPROVAL).toContain(KRAKEN_TOOL_NAMES.CANCEL_ORDER);
  });

  test("read-only tools do not require approval", () => {
    const readOnly = [
      KRAKEN_TOOL_NAMES.BALANCE,
      KRAKEN_TOOL_NAMES.TICKER,
      KRAKEN_TOOL_NAMES.OHLC,
      KRAKEN_TOOL_NAMES.OPEN_ORDERS,
      KRAKEN_TOOL_NAMES.CLOSED_ORDERS,
      KRAKEN_TOOL_NAMES.PORTFOLIO,
    ];
    for (const name of readOnly) {
      expect(KRAKEN_TOOLS_REQUIRING_APPROVAL).not.toContain(name);
    }
  });

  test("isKrakenTool returns true for all tool names", () => {
    for (const name of Object.values(KRAKEN_TOOL_NAMES)) {
      expect(isKrakenTool(name)).toBe(true);
    }
  });

  test("tools array contains all 8 tool definitions", () => {
    const kt = new KrakenTools();
    expect(kt.tools).toHaveLength(8);
    const names = kt.tools.map((t) => t.name);
    for (const toolName of Object.values(KRAKEN_TOOL_NAMES)) {
      expect(names).toContain(toolName);
    }
  });
});

// ─── No credentials ───────────────────────────────────────────────────────────

describe("KrakenTools — no credentials", () => {
  test("throws helpful error when no integration found", async () => {
    const kt = new KrakenTools();
    await expect(kt.execute(KRAKEN_TOOL_NAMES.BALANCE, {}, makeCtx("user-no-creds")))
      .rejects.toThrow("No Kraken API credentials configured");
  });

  test("throws when userId is empty", async () => {
    const kt = new KrakenTools();
    await expect(kt.execute(KRAKEN_TOOL_NAMES.BALANCE, {}, { threadId: "t1" }))
      .rejects.toThrow("require an authenticated user");
  });
});

// ─── kraken_balance ───────────────────────────────────────────────────────────

describe("KrakenTools.execute — kraken_balance", () => {
  test("returns usdBalance and full balances map", async () => {
    mockFetch({ "/0/private/Balance": { ZUSD: "150.00", XXBT: "0.002" } });
    const kt = new KrakenTools();
    const result = await kt.execute(KRAKEN_TOOL_NAMES.BALANCE, {}, makeCtx()) as Record<string, unknown>;
    expect(result.usdBalance).toBe(150);
    expect((result.balances as Record<string, string>)["XXBT"]).toBe("0.002");
  });
});

// ─── kraken_ticker ────────────────────────────────────────────────────────────

describe("KrakenTools.execute — kraken_ticker", () => {
  const tickerData = {
    XBTUSD: { a: ["65000", "1"], b: ["64999", "1"], c: ["65000", "1"], v: ["1", "100"], h: ["66000", "66000"], l: ["64000", "64000"] },
  };

  test("returns tickers for specified pairs", async () => {
    mockFetch({ "/0/public/Ticker": tickerData });
    const kt = new KrakenTools();
    const result = await kt.execute(KRAKEN_TOOL_NAMES.TICKER, { pairs: ["XBTUSD"] }, makeCtx()) as Record<string, unknown>;
    expect(result.count).toBe(1);
    expect((result.tickers as Array<{ pair: string }>)[0].pair).toBe("XBTUSD");
  });

  test("uses DEFAULT_PAIRS when no pairs arg provided", async () => {
    mockFetch({ "/0/public/Ticker": tickerData });
    const spy = jest.spyOn(global, "fetch").mockImplementation(
      () => Promise.resolve({ json: async () => ({ error: [], result: tickerData }) } as Response)
    );
    const kt = new KrakenTools();
    await kt.execute(KRAKEN_TOOL_NAMES.TICKER, {}, makeCtx());
    const [url] = spy.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain("XBTUSD");
  });
});

// ─── kraken_ohlc ─────────────────────────────────────────────────────────────

describe("KrakenTools.execute — kraken_ohlc", () => {
  test("throws when pair is missing", async () => {
    const kt = new KrakenTools();
    await expect(kt.execute(KRAKEN_TOOL_NAMES.OHLC, {}, makeCtx()))
      .rejects.toThrow("Missing required arg: pair");
  });

  test("returns candle data sliced to limit", async () => {
    const candles = Array.from({ length: 50 }, (_, i) => [i, "1", "2", "0.5", "1.5", "1", "100", 1]);
    mockFetch({ "/0/public/OHLC": { XBTUSD: candles, last: 0 } });
    const kt = new KrakenTools();
    const result = await kt.execute(KRAKEN_TOOL_NAMES.OHLC, { pair: "XBTUSD", limit: 10 }, makeCtx()) as Record<string, unknown>;
    expect((result.candles as unknown[]).length).toBe(10);
    expect(result.pair).toBe("XBTUSD");
  });
});

// ─── kraken_place_order ───────────────────────────────────────────────────────

describe("KrakenTools.execute — kraken_place_order", () => {
  test("throws when pair is missing", async () => {
    const kt = new KrakenTools();
    await expect(kt.execute(KRAKEN_TOOL_NAMES.PLACE_ORDER, { side: "buy", volumeBase: "0.001" }, makeCtx()))
      .rejects.toThrow("Missing required arg: pair");
  });

  test("throws when neither volumeBase nor volumeUsd provided", async () => {
    mockFetch({ "/0/public/Ticker": {} });
    const kt = new KrakenTools();
    await expect(kt.execute(KRAKEN_TOOL_NAMES.PLACE_ORDER, { pair: "XBTUSD", side: "buy" }, makeCtx()))
      .rejects.toThrow("volumeBase");
  });

  test("places order with volumeBase directly", async () => {
    mockFetch({
      "/0/private/AddOrder": { txid: ["TX123"], descr: { order: "buy 0.001 XBTUSD @ market" } },
    });
    const kt = new KrakenTools();
    const result = await kt.execute(
      KRAKEN_TOOL_NAMES.PLACE_ORDER,
      { pair: "XBTUSD", side: "buy", volumeBase: "0.001" },
      makeCtx(),
    ) as Record<string, unknown>;
    expect(result.status).toBe("placed");
    expect(result.txid).toEqual(["TX123"]);
    expect(result.volume).toBe("0.001");
  });

  test("converts volumeUsd to base volume using current ticker price", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/0/public/Ticker")) {
        return Promise.resolve({
          json: async () => ({
            error: [], result: {
              XBTUSD: { a: ["65000", "1"], b: ["64999", "1"], c: ["65000", "1"], v: ["1", "1"], h: ["65000", "65000"], l: ["65000", "65000"] }
            }
          })
        } as Response);
      }
      return Promise.resolve({
        json: async () => ({ error: [], result: { txid: ["TX456"], descr: { order: "buy ... @ market" } } })
      } as Response);
    });
    const kt = new KrakenTools();
    const result = await kt.execute(
      KRAKEN_TOOL_NAMES.PLACE_ORDER,
      { pair: "XBTUSD", side: "buy", volumeUsd: 65 },
      makeCtx(),
    ) as Record<string, unknown>;
    expect(result.status).toBe("placed");
    expect(parseFloat(result.volume as string)).toBeCloseTo(0.001, 5);
    spy.mockRestore();
  });
});

// ─── kraken_cancel_order ──────────────────────────────────────────────────────

describe("KrakenTools.execute — kraken_cancel_order", () => {
  test("throws when txid is missing", async () => {
    const kt = new KrakenTools();
    await expect(kt.execute(KRAKEN_TOOL_NAMES.CANCEL_ORDER, {}, makeCtx()))
      .rejects.toThrow("Missing required arg: txid");
  });

  test("returns cancelled status on success", async () => {
    mockFetch({ "/0/private/CancelOrder": { count: 1 } });
    const kt = new KrakenTools();
    const result = await kt.execute(KRAKEN_TOOL_NAMES.CANCEL_ORDER, { txid: "TX123" }, makeCtx()) as Record<string, unknown>;
    expect(result.status).toBe("cancelled");
    expect(result.txid).toBe("TX123");
  });
});

// ─── kraken_portfolio ─────────────────────────────────────────────────────────

describe("KrakenTools.execute — kraken_portfolio", () => {
  test("returns empty portfolio when no positions", async () => {
    const kt = new KrakenTools();
    const result = await kt.execute(KRAKEN_TOOL_NAMES.PORTFOLIO, {}, makeCtx()) as Record<string, unknown>;
    expect(result.count).toBe(0);
    expect(result.positions).toEqual([]);
  });
});

// ─── unknown tool ─────────────────────────────────────────────────────────────

describe("KrakenTools.execute — unknown tool", () => {
  test("throws for unrecognised tool name", async () => {
    const kt = new KrakenTools();
    await expect(kt.execute("builtin.kraken_unknown", {}, makeCtx()))
      .rejects.toThrow("Unknown Kraken tool");
  });
});
