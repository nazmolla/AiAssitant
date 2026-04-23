import { KrakenClient, KrakenError, usdToVolume, checkTradeRisk, type TradingRisk } from "@/lib/integrations/kraken";

const FAKE_KEY = "fake-api-key";
const FAKE_SECRET = Buffer.from("fake-secret-bytes-padded-for-base64").toString("base64");

function makeFetchOk(body: unknown) {
  return jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue({ error: [], result: body }),
  });
}

function makeFetchError(errors: string[]) {
  return jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue({ error: errors }),
  });
}

afterEach(() => jest.restoreAllMocks());

// ─── Constructor ──────────────────────────────────────────────────────────────

describe("KrakenClient constructor", () => {
  test("throws when apiKey is empty", () => {
    expect(() => new KrakenClient("", FAKE_SECRET)).toThrow("apiKey and apiSecret are required");
  });

  test("throws when apiSecret is empty", () => {
    expect(() => new KrakenClient(FAKE_KEY, "")).toThrow("apiKey and apiSecret are required");
  });

  test("constructs without throwing when both args provided", () => {
    expect(() => new KrakenClient(FAKE_KEY, FAKE_SECRET)).not.toThrow();
  });
});

// ─── getBalance ───────────────────────────────────────────────────────────────

describe("KrakenClient.getBalance", () => {
  test("returns parsed balance map", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(
      makeFetchOk({ ZUSD: "97.50", XXBT: "0.001" }) as typeof fetch,
    );
    const client = new KrakenClient(FAKE_KEY, FAKE_SECRET);
    const balance = await client.getBalance();
    expect(balance["ZUSD"]).toBe("97.50");
    expect(balance["XXBT"]).toBe("0.001");
    expect(spy).toHaveBeenCalledTimes(1);
    const [url] = spy.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain("/0/private/Balance");
  });

  test("throws KrakenError on API error response", async () => {
    jest.spyOn(global, "fetch").mockImplementation(
      makeFetchError(["EGeneral:Invalid key"]) as typeof fetch,
    );
    const client = new KrakenClient(FAKE_KEY, FAKE_SECRET);
    await expect(client.getBalance()).rejects.toBeInstanceOf(KrakenError);
  });
});

// ─── getUsdBalance ────────────────────────────────────────────────────────────

describe("KrakenClient.getUsdBalance", () => {
  test("returns numeric ZUSD balance", async () => {
    jest.spyOn(global, "fetch").mockImplementation(
      makeFetchOk({ ZUSD: "123.45" }) as typeof fetch,
    );
    const client = new KrakenClient(FAKE_KEY, FAKE_SECRET);
    expect(await client.getUsdBalance()).toBe(123.45);
  });

  test("returns 0 when ZUSD not present", async () => {
    jest.spyOn(global, "fetch").mockImplementation(
      makeFetchOk({ XXBT: "1.0" }) as typeof fetch,
    );
    const client = new KrakenClient(FAKE_KEY, FAKE_SECRET);
    expect(await client.getUsdBalance()).toBe(0);
  });
});

// ─── getTicker ────────────────────────────────────────────────────────────────

describe("KrakenClient.getTicker", () => {
  test("maps Kraken ticker fields correctly", async () => {
    jest.spyOn(global, "fetch").mockImplementation(
      makeFetchOk({
        XBTUSD: {
          a: ["65000.00", "1"],
          b: ["64999.00", "1"],
          c: ["65000.00", "1"],
          v: ["0.001", "100.5"],
          h: ["66000", "67000"],
          l: ["64000", "63500"],
        },
      }) as typeof fetch,
    );
    const client = new KrakenClient(FAKE_KEY, FAKE_SECRET);
    const tickers = await client.getTicker(["XBTUSD"]);
    expect(tickers).toHaveLength(1);
    expect(tickers[0].pair).toBe("XBTUSD");
    expect(tickers[0].ask).toBe("65000.00");
    expect(tickers[0].bid).toBe("64999.00");
    expect(tickers[0].last).toBe("65000.00");
    expect(tickers[0].volume24h).toBe("100.5");
  });
});

// ─── placeOrder ───────────────────────────────────────────────────────────────

describe("KrakenClient.placeOrder", () => {
  test("calls AddOrder endpoint with correct params", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(
      makeFetchOk({ txid: ["OABC123"], descr: { order: "buy 0.001 XBTUSD @ market" } }) as typeof fetch,
    );
    const client = new KrakenClient(FAKE_KEY, FAKE_SECRET);
    const result = await client.placeOrder({ pair: "XBTUSD", type: "buy", volume: "0.001" });
    expect(result.txid).toEqual(["OABC123"]);
    const [url, opts] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/0/private/AddOrder");
    expect(opts.headers).toMatchObject({ "API-Key": FAKE_KEY });
    const body = String(opts.body);
    expect(body).toContain("pair=XBTUSD");
    expect(body).toContain("type=buy");
    expect(body).toContain("volume=0.001");
  });

  test("throws KrakenError on insufficient funds", async () => {
    jest.spyOn(global, "fetch").mockImplementation(
      makeFetchError(["EOrder:Insufficient funds"]) as typeof fetch,
    );
    const client = new KrakenClient(FAKE_KEY, FAKE_SECRET);
    const err = await client.placeOrder({ pair: "XBTUSD", type: "buy", volume: "1.0" }).catch((e) => e);
    expect(err).toBeInstanceOf(KrakenError);
    expect((err as KrakenError).isInsufficientFunds).toBe(true);
  });
});

// ─── Request signs with API-Sign header ───────────────────────────────────────

describe("KrakenClient HMAC signature", () => {
  test("private request includes API-Sign header", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation(
      makeFetchOk({ ZUSD: "0" }) as typeof fetch,
    );
    const client = new KrakenClient(FAKE_KEY, FAKE_SECRET);
    await client.getBalance();
    const [, opts] = spy.mock.calls[0] as [string, RequestInit];
    expect(typeof (opts.headers as Record<string, string>)["API-Sign"]).toBe("string");
    expect((opts.headers as Record<string, string>)["API-Sign"].length).toBeGreaterThan(20);
  });
});

// ─── KrakenError ──────────────────────────────────────────────────────────────

describe("KrakenError", () => {
  test("isAuthError detects Invalid key", () => {
    const err = new KrakenError(["EGeneral:Invalid key"], "/test");
    expect(err.isAuthError).toBe(true);
  });

  test("isAuthError detects Permission denied", () => {
    const err = new KrakenError(["EGeneral:Permission denied"], "/test");
    expect(err.isAuthError).toBe(true);
  });

  test("isInsufficientFunds detects Insufficient funds", () => {
    const err = new KrakenError(["EOrder:Insufficient funds"], "/test");
    expect(err.isInsufficientFunds).toBe(true);
  });

  test("non-auth, non-funds error returns false for both flags", () => {
    const err = new KrakenError(["EGeneral:Unknown error"], "/test");
    expect(err.isAuthError).toBe(false);
    expect(err.isInsufficientFunds).toBe(false);
  });
});

// ─── usdToVolume ──────────────────────────────────────────────────────────────

describe("usdToVolume", () => {
  test("converts $65000 at BTC price 65000 to 1.00000000", () => {
    expect(usdToVolume(65000, 65000)).toBe("1.00000000");
  });

  test("converts $20 at price 100000 to 0.00020000", () => {
    expect(usdToVolume(20, 100000)).toBe("0.00020000");
  });

  test("handles fractional USD amounts", () => {
    const vol = parseFloat(usdToVolume(15.5, 50000));
    expect(vol).toBeCloseTo(0.00031, 5);
  });
});
