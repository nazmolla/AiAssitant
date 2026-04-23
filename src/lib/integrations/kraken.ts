/**
 * Kraken REST API client.
 *
 * Credentials are passed in directly — never read from global env vars —
 * so each user can supply their own API key and secret.
 *
 * Docs: https://docs.kraken.com/rest/
 * Auth: HMAC-SHA512 (API-Key + API-Sign headers)
 */

import * as crypto from "crypto";

const BASE = "https://api.kraken.com";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface KrakenBalance {
  /** Map of asset name → balance string (e.g. { "ZUSD": "97.50", "XXBT": "0.001" }) */
  [asset: string]: string;
}

export interface KrakenOHLC {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  vwap: string;
  volume: string;
  count: number;
}

export interface KrakenTicker {
  pair: string;
  ask: string;   // best ask price
  bid: string;   // best bid price
  last: string;  // last trade price
  volume24h: string;
  high24h: string;
  low24h: string;
}

export interface KrakenOrderResult {
  txid: string[];
  descr: { order: string };
}

export interface KrakenOpenOrder {
  txid: string;
  pair: string;
  type: "buy" | "sell";
  ordertype: string;
  price: string;
  vol: string;
  vol_exec: string;
  status: string;
  descr: { order: string };
  opentm: number;
}

export interface KrakenClosedOrder {
  txid: string;
  pair: string;
  type: "buy" | "sell";
  ordertype: string;
  price: string;
  cost: string;
  fee: string;
  vol: string;
  vol_exec: string;
  status: string;
  closetm: number;
}

export interface PlaceOrderParams {
  pair: string;
  type: "buy" | "sell";
  ordertype?: "market" | "limit";
  /** Volume in base currency (e.g. XBT for XBTUSD). */
  volume: string;
  /** Required for limit orders. */
  price?: string;
}

export interface TradingRisk {
  /** USD balance available to trade. */
  balanceUsd: number;
  /** Max fraction of balance per trade (e.g. 0.25 = 25%). */
  maxPositionPct: number;
  /** Stop-loss: close position if unrealised loss exceeds this fraction (e.g. 0.10). */
  stopLossPct: number;
  /** Stop trading if today's cumulative loss exceeds this USD amount. */
  dailyLossCapUsd: number;
  /** Minimum order size in USD — Kraken rejects orders below ~$10. */
  minTradeUsd: number;
}

export interface RiskCheckResult {
  approved: boolean;
  reason: string;
}

// ─── Risk gate ────────────────────────────────────────────────────────────────

export function checkTradeRisk(
  proposedVolumeUsd: number,
  todayLossUsd: number,
  risk: TradingRisk,
): RiskCheckResult {
  if (risk.balanceUsd < risk.minTradeUsd) {
    return {
      approved: false,
      reason: `Balance $${risk.balanceUsd.toFixed(2)} is below minimum trade size $${risk.minTradeUsd.toFixed(2)}. Stopping.`,
    };
  }
  if (todayLossUsd >= risk.dailyLossCapUsd) {
    return {
      approved: false,
      reason: `Daily loss cap reached: $${todayLossUsd.toFixed(2)} >= cap $${risk.dailyLossCapUsd.toFixed(2)}. No more trades today.`,
    };
  }
  const maxAllowed = risk.balanceUsd * risk.maxPositionPct;
  if (proposedVolumeUsd > maxAllowed) {
    return {
      approved: false,
      reason: `Order size $${proposedVolumeUsd.toFixed(2)} exceeds max ${(risk.maxPositionPct * 100).toFixed(0)}% of balance ($${maxAllowed.toFixed(2)}).`,
    };
  }
  if (proposedVolumeUsd < risk.minTradeUsd) {
    return {
      approved: false,
      reason: `Order size $${proposedVolumeUsd.toFixed(2)} is below Kraken minimum $${risk.minTradeUsd.toFixed(2)}.`,
    };
  }
  return { approved: true, reason: "Risk checks passed." };
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class KrakenClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    if (!apiKey || !apiSecret) {
      throw new Error("KrakenClient: apiKey and apiSecret are required.");
    }
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  // ─── Signature ─────────────────────────────────────────────────────────────

  private sign(path: string, nonce: number, body: string): string {
    const sha256 = crypto
      .createHash("sha256")
      .update(String(nonce) + body)
      .digest();
    const secretBuf = Buffer.from(this.apiSecret, "base64");
    const hmac = crypto.createHmac("sha512", secretBuf);
    hmac.update(path);
    hmac.update(sha256);
    return hmac.digest("base64");
  }

  // ─── Private request ───────────────────────────────────────────────────────

  private async privateRequest<T>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const nonce = Date.now() * 1000;
    const body = new URLSearchParams({ nonce: String(nonce), ...params }).toString();
    const sign = this.sign(path, nonce, body);

    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "API-Key": this.apiKey,
        "API-Sign": sign,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const json = await res.json() as { error: string[]; result?: T };
    if (json.error && json.error.length > 0) {
      throw new KrakenError(json.error, path);
    }
    return json.result as T;
  }

  // ─── Public request ────────────────────────────────────────────────────────

  private async publicRequest<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
    const res = await fetch(url);
    const json = await res.json() as { error: string[]; result?: T };
    if (json.error && json.error.length > 0) {
      throw new KrakenError(json.error, path);
    }
    return json.result as T;
  }

  // ─── Account ───────────────────────────────────────────────────────────────

  /** Returns all asset balances. Filter to ZUSD for USD balance. */
  async getBalance(): Promise<KrakenBalance> {
    return this.privateRequest<KrakenBalance>("/0/private/Balance");
  }

  /** USD balance as a number. Returns 0 if no USD held. */
  async getUsdBalance(): Promise<number> {
    const balance = await this.getBalance();
    return parseFloat(balance["ZUSD"] ?? "0");
  }

  // ─── Market data ───────────────────────────────────────────────────────────

  /**
   * Fetch OHLC candles for a pair.
   * @param pair  Kraken pair name e.g. "XBTUSD"
   * @param interval  Candle interval in minutes (1, 5, 15, 30, 60, 240, 1440)
   */
  async getOHLC(pair: string, interval: number = 1440): Promise<KrakenOHLC[]> {
    const result = await this.publicRequest<Record<string, unknown[]>>("/0/public/OHLC", {
      pair,
      interval: String(interval),
    });
    // Result key is the pair name (may differ slightly from input)
    const key = Object.keys(result).find((k) => k !== "last");
    if (!key) return [];
    return (result[key] as unknown[][]).map((row) => ({
      time: row[0] as number,
      open: row[1] as string,
      high: row[2] as string,
      low: row[3] as string,
      close: row[4] as string,
      vwap: row[5] as string,
      volume: row[6] as string,
      count: row[7] as number,
    }));
  }

  /** Fetch ticker for one or more pairs (comma-separated). */
  async getTicker(pairs: string[]): Promise<KrakenTicker[]> {
    const result = await this.publicRequest<Record<string, Record<string, unknown>>>(
      "/0/public/Ticker",
      { pair: pairs.join(",") },
    );
    return Object.entries(result).map(([pair, t]) => ({
      pair,
      ask: (t["a"] as string[])[0],
      bid: (t["b"] as string[])[0],
      last: (t["c"] as string[])[0],
      volume24h: (t["v"] as string[])[1],
      high24h: (t["h"] as string[])[1],
      low24h: (t["l"] as string[])[1],
    }));
  }

  // ─── Orders ────────────────────────────────────────────────────────────────

  async placeOrder(params: PlaceOrderParams): Promise<KrakenOrderResult> {
    const p: Record<string, string> = {
      pair: params.pair,
      type: params.type,
      ordertype: params.ordertype ?? "market",
      volume: params.volume,
    };
    if (params.price) p.price = params.price;
    return this.privateRequest<KrakenOrderResult>("/0/private/AddOrder", p);
  }

  async cancelOrder(txid: string): Promise<void> {
    await this.privateRequest("/0/private/CancelOrder", { txid });
  }

  async getOpenOrders(): Promise<KrakenOpenOrder[]> {
    const result = await this.privateRequest<{ open: Record<string, unknown> }>("/0/private/OpenOrders");
    return Object.entries(result.open ?? {}).map(([txid, o]) => {
      const order = o as Record<string, unknown>;
      const descr = order["descr"] as Record<string, string>;
      return {
        txid,
        pair: descr["pair"],
        type: descr["type"] as "buy" | "sell",
        ordertype: descr["ordertype"],
        price: descr["price"],
        vol: order["vol"] as string,
        vol_exec: order["vol_exec"] as string,
        status: order["status"] as string,
        descr: { order: descr["order"] },
        opentm: order["opentm"] as number,
      };
    });
  }

  async getClosedOrders(start?: number): Promise<KrakenClosedOrder[]> {
    const params: Record<string, string> = {};
    if (start) params.start = String(start);
    const result = await this.privateRequest<{ closed: Record<string, unknown> }>(
      "/0/private/ClosedOrders",
      params,
    );
    return Object.entries(result.closed ?? {}).map(([txid, o]) => {
      const order = o as Record<string, unknown>;
      const descr = order["descr"] as Record<string, string>;
      return {
        txid,
        pair: descr["pair"],
        type: descr["type"] as "buy" | "sell",
        ordertype: descr["ordertype"],
        price: order["price"] as string,
        cost: order["cost"] as string,
        fee: order["fee"] as string,
        vol: order["vol"] as string,
        vol_exec: order["vol_exec"] as string,
        status: order["status"] as string,
        closetm: order["closetm"] as number,
      };
    });
  }
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class KrakenError extends Error {
  constructor(
    public readonly errors: string[],
    public readonly path: string,
  ) {
    super(`Kraken API error at ${path}: ${errors.join(", ")}`);
    this.name = "KrakenError";
  }

  get isAuthError(): boolean {
    return this.errors.some((e) => e.includes("Invalid key") || e.includes("Invalid signature") || e.includes("Permission denied"));
  }

  get isInsufficientFunds(): boolean {
    return this.errors.some((e) => e.includes("Insufficient funds"));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Top pairs to watch by default. User/agent can expand this. */
export const DEFAULT_PAIRS = ["XBTUSD", "ETHUSD", "SOLUSD", "ADAUSD", "XRPUSD"] as const;

/**
 * Convert USD amount to base currency volume for a given pair.
 * e.g. $20 at BTC price $100,000 → 0.0002 XBT
 */
export function usdToVolume(usdAmount: number, lastPrice: number): string {
  const vol = usdAmount / lastPrice;
  return vol.toFixed(8);
}
