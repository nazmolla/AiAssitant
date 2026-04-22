/**
 * Unit tests — AlpacaClient
 *
 * All HTTP calls are intercepted by jest.spyOn(global, 'fetch').
 * No real network requests are made.
 */

import { AlpacaClient, AlpacaError, checkRisk } from "@/lib/integrations/alpaca";

// ─── env mock ─────────────────────────────────────────────────────────────────

jest.mock("@/lib/env", () => ({
  env: {
    ALPACA_API_KEY: "test-key-id",
    ALPACA_API_SECRET: "test-secret",
    ALPACA_MODE: "paper",
  },
}));

// ─── fetch mock helpers ────────────────────────────────────────────────────────

afterEach(() => {
  jest.restoreAllMocks();
});

function mockFetch(body: unknown, status = 200) {
  return jest.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: async () => JSON.stringify(body),
  } as Response);
}

// ─── AlpacaClient construction ────────────────────────────────────────────────

describe("AlpacaClient — construction", () => {
  it("throws when credentials are missing", () => {
    jest.resetModules();
    jest.doMock("@/lib/env", () => ({
      env: { ALPACA_API_KEY: "", ALPACA_API_SECRET: "", ALPACA_MODE: "paper" },
    }));
    const { AlpacaClient: Fresh } = require("@/lib/integrations/alpaca") as typeof import("@/lib/integrations/alpaca");
    expect(() => new Fresh()).toThrow("Alpaca credentials missing");
    jest.resetModules();
  });

  it("defaults to paper mode when ALPACA_MODE is not 'live'", () => {
    const client = new AlpacaClient();
    expect(client.tradingMode).toBe("paper");
  });

  it("uses live mode when explicitly passed", () => {
    const client = new AlpacaClient("live");
    expect(client.tradingMode).toBe("live");
  });
});

// ─── getAccount ───────────────────────────────────────────────────────────────

describe("AlpacaClient.getAccount()", () => {
  it("returns account data on 200", async () => {
    const payload = { id: "acc-1", equity: "100.00", cash: "100.00", status: "ACTIVE" };
    mockFetch(payload);
    const client = new AlpacaClient();
    const account = await client.getAccount();
    expect(account.id).toBe("acc-1");
    expect(account.cash).toBe("100.00");
  });

  it("throws AlpacaError on non-2xx", async () => {
    mockFetch({ message: "Unauthorized" }, 401);
    const client = new AlpacaClient();
    await expect(client.getAccount()).rejects.toThrow(AlpacaError);
  });

  it("AlpacaError.isAuthError is true for 401", async () => {
    mockFetch({ message: "Unauthorized" }, 401);
    const client = new AlpacaClient();
    try {
      await client.getAccount();
    } catch (e) {
      expect(e).toBeInstanceOf(AlpacaError);
      expect((e as AlpacaError).isAuthError).toBe(true);
    }
  });

  it("sends correct auth headers", async () => {
    const fetchSpy = mockFetch({ id: "acc-2", equity: "50.00", cash: "50.00", status: "ACTIVE" });
    const client = new AlpacaClient();
    await client.getAccount();
    const callArgs = fetchSpy.mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers["APCA-API-KEY-ID"]).toBe("test-key-id");
    expect(headers["APCA-API-SECRET-KEY"]).toBe("test-secret");
  });
});

// ─── getPositions ─────────────────────────────────────────────────────────────

describe("AlpacaClient.getPositions()", () => {
  it("returns empty array when no positions", async () => {
    mockFetch([]);
    const client = new AlpacaClient();
    const positions = await client.getPositions();
    expect(positions).toEqual([]);
  });

  it("returns position list", async () => {
    const payload = [
      { symbol: "AAPL", qty: "0.5", avg_entry_price: "180.00", current_price: "195.00",
        market_value: "97.50", unrealized_pl: "7.50", unrealized_plpc: "0.083", side: "long" },
    ];
    mockFetch(payload);
    const client = new AlpacaClient();
    const positions = await client.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe("AAPL");
    expect(positions[0].side).toBe("long");
  });
});

// ─── placeOrder ───────────────────────────────────────────────────────────────

describe("AlpacaClient.placeOrder()", () => {
  it("throws if neither qty nor notional is provided", async () => {
    const client = new AlpacaClient();
    await expect(
      client.placeOrder({ symbol: "AAPL", side: "buy" })
    ).rejects.toThrow("placeOrder: provide qty or notional");
  });

  it("places a notional market buy", async () => {
    const orderPayload = {
      id: "order-123", client_order_id: "c-1", symbol: "AAPL", qty: null,
      notional: "20.00", side: "buy", type: "market", time_in_force: "day",
      status: "accepted", filled_qty: "0", filled_avg_price: null,
      limit_price: null, stop_price: null,
      created_at: "2026-04-22T14:45:00Z", updated_at: "2026-04-22T14:45:00Z",
      submitted_at: "2026-04-22T14:45:00Z", filled_at: null,
    };
    const fetchSpy = mockFetch(orderPayload);
    const client = new AlpacaClient();
    const order = await client.placeOrder({ symbol: "AAPL", side: "buy", notional: 20 });
    expect(order.id).toBe("order-123");
    expect(order.side).toBe("buy");

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.symbol).toBe("AAPL");
    expect(body.notional).toBe("20");
    expect(body.type).toBe("market");
  });

  it("places a qty sell", async () => {
    const orderPayload = {
      id: "order-456", client_order_id: "c-2", symbol: "MSFT", qty: "1",
      notional: null, side: "sell", type: "market", time_in_force: "day",
      status: "accepted", filled_qty: "0", filled_avg_price: null,
      limit_price: null, stop_price: null,
      created_at: "2026-04-22T14:45:00Z", updated_at: "2026-04-22T14:45:00Z",
      submitted_at: "2026-04-22T14:45:00Z", filled_at: null,
    };
    const fetchSpy = mockFetch(orderPayload);
    const client = new AlpacaClient();
    await client.placeOrder({ symbol: "MSFT", side: "sell", qty: 1 });
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.side).toBe("sell");
    expect(body.qty).toBe("1");
  });

  it("uses paper API base when mode=paper", async () => {
    const orderPayload = {
      id: "order-789", client_order_id: "c-3", symbol: "GOOGL", qty: null,
      notional: "10.00", side: "buy", type: "market", time_in_force: "day",
      status: "accepted", filled_qty: "0", filled_avg_price: null,
      limit_price: null, stop_price: null,
      created_at: "2026-04-22T14:45:00Z", updated_at: "2026-04-22T14:45:00Z",
      submitted_at: "2026-04-22T14:45:00Z", filled_at: null,
    };
    const fetchSpy = mockFetch(orderPayload);
    const client = new AlpacaClient("paper");
    await client.placeOrder({ symbol: "GOOGL", side: "buy", notional: 10 });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("paper-api.alpaca.markets");
  });
});

// ─── getBars ──────────────────────────────────────────────────────────────────

describe("AlpacaClient.getBars()", () => {
  it("returns bar array for given symbol", async () => {
    const bars = [
      { t: "2026-04-21T14:30:00Z", o: 190.0, h: 196.0, l: 189.0, c: 195.0, v: 100000, vw: 193.5 },
    ];
    mockFetch({ bars: { AAPL: bars } });
    const client = new AlpacaClient();
    const result = await client.getBars("AAPL");
    expect(result).toHaveLength(1);
    expect(result[0].c).toBe(195.0);
  });

  it("returns empty array when symbol absent from response", async () => {
    mockFetch({ bars: {} });
    const client = new AlpacaClient();
    const result = await client.getBars("UNKNOWN");
    expect(result).toEqual([]);
  });
});
