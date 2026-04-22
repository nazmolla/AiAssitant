/**
 * Alpaca Markets REST API client.
 *
 * Supports both paper (ALPACA_MODE=paper) and live (ALPACA_MODE=live) trading.
 * Credentials are read exclusively from environment variables — never hardcoded.
 *
 * Docs: https://docs.alpaca.markets/reference
 */

import { env } from "@/lib/env";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlpacaMode = "paper" | "live";

export interface AlpacaAccount {
  id: string;
  status: string;
  currency: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  last_equity: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  side: "long" | "short";
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  qty: string | null;
  notional: string | null;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  time_in_force: "day" | "gtc" | "ioc" | "fok";
  status: string;
  filled_qty: string;
  filled_avg_price: string | null;
  limit_price: string | null;
  stop_price: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
}

export interface PlaceOrderParams {
  symbol: string;
  side: "buy" | "sell";
  /** Fractional qty allowed; pass notional for dollar-value orders. */
  qty?: number;
  /** Dollar value of the order (alternative to qty). */
  notional?: number;
  type?: "market" | "limit";
  time_in_force?: "day" | "gtc";
  limit_price?: number;
}

export interface AlpacaBar {
  t: string;   // timestamp ISO-8601
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume
  vw: number;  // volume-weighted average price
}

export interface AlpacaQuote {
  symbol: string;
  bid_price: number;
  ask_price: number;
  bid_size: number;
  ask_size: number;
  timestamp: string;
}

export interface AlpacaNewsArticle {
  id: number;
  headline: string;
  summary: string;
  author: string;
  created_at: string;
  updated_at: string;
  url: string;
  symbols: string[];
  source: string;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class AlpacaClient {
  private readonly mode: AlpacaMode;
  private readonly brokerBase: string;
  private readonly dataBase: string;
  private readonly keyId: string;
  private readonly secretKey: string;

  constructor(mode?: AlpacaMode) {
    this.mode = mode ?? (env.ALPACA_MODE === "live" ? "live" : "paper");
    this.brokerBase =
      this.mode === "live"
        ? "https://api.alpaca.markets"
        : "https://paper-api.alpaca.markets";
    this.dataBase = "https://data.alpaca.markets";
    this.keyId = env.ALPACA_API_KEY ?? "";
    this.secretKey = env.ALPACA_API_SECRET ?? "";

    if (!this.keyId || !this.secretKey) {
      throw new Error(
        "Alpaca credentials missing. Set ALPACA_API_KEY and ALPACA_API_SECRET environment variables."
      );
    }
  }

  get tradingMode(): AlpacaMode {
    return this.mode;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      "APCA-API-KEY-ID": this.keyId,
      "APCA-API-SECRET-KEY": this.secretKey,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    base: string,
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${base}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: { ...this.headers(), ...(options.headers as Record<string, string> | undefined) },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AlpacaError(res.status, res.statusText, body, path);
    }

    const text = await res.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  // ─── Account ──────────────────────────────────────────────────────────────

  async getAccount(): Promise<AlpacaAccount> {
    return this.request<AlpacaAccount>(this.brokerBase, "/v2/account");
  }

  // ─── Positions ────────────────────────────────────────────────────────────

  async getPositions(): Promise<AlpacaPosition[]> {
    return this.request<AlpacaPosition[]>(this.brokerBase, "/v2/positions");
  }

  async getPosition(symbol: string): Promise<AlpacaPosition> {
    return this.request<AlpacaPosition>(
      this.brokerBase,
      `/v2/positions/${encodeURIComponent(symbol.toUpperCase())}`
    );
  }

  // ─── Orders ───────────────────────────────────────────────────────────────

  async placeOrder(params: PlaceOrderParams): Promise<AlpacaOrder> {
    const body: Record<string, unknown> = {
      symbol: params.symbol.toUpperCase(),
      side: params.side,
      type: params.type ?? "market",
      time_in_force: params.time_in_force ?? "day",
    };

    if (params.notional !== undefined) {
      body.notional = String(params.notional);
    } else if (params.qty !== undefined) {
      body.qty = String(params.qty);
    } else {
      throw new Error("placeOrder: provide qty or notional");
    }

    if (params.limit_price !== undefined) {
      body.limit_price = String(params.limit_price);
    }

    return this.request<AlpacaOrder>(this.brokerBase, "/v2/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request<void>(
      this.brokerBase,
      `/v2/orders/${encodeURIComponent(orderId)}`,
      { method: "DELETE" }
    );
  }

  async getOrders(params?: { status?: string; limit?: number }): Promise<AlpacaOrder[]> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.request<AlpacaOrder[]>(this.brokerBase, `/v2/orders${query}`);
  }

  async getOrder(orderId: string): Promise<AlpacaOrder> {
    return this.request<AlpacaOrder>(
      this.brokerBase,
      `/v2/orders/${encodeURIComponent(orderId)}`
    );
  }

  // ─── Market data ──────────────────────────────────────────────────────────

  /**
   * Fetch historical OHLCV bars for a symbol.
   * @param symbol Ticker symbol (e.g. "AAPL")
   * @param timeframe Bar timeframe (e.g. "1Day", "1Hour", "5Min")
   * @param limit Max number of bars (default 20)
   */
  async getBars(
    symbol: string,
    timeframe: string = "1Day",
    limit: number = 20
  ): Promise<AlpacaBar[]> {
    const qs = new URLSearchParams({
      symbols: symbol.toUpperCase(),
      timeframe,
      limit: String(limit),
      feed: "iex",
    });
    const data = await this.request<{ bars: Record<string, AlpacaBar[]> }>(
      this.dataBase,
      `/v2/stocks/bars?${qs.toString()}`
    );
    return data.bars?.[symbol.toUpperCase()] ?? [];
  }

  /**
   * Fetch latest quote for a symbol.
   */
  async getLatestQuote(symbol: string): Promise<AlpacaQuote> {
    const data = await this.request<{ quotes: Record<string, AlpacaQuote> }>(
      this.dataBase,
      `/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/quotes/latest`
    );
    const quote = data.quotes?.[symbol.toUpperCase()];
    if (!quote) throw new Error(`No quote data for ${symbol}`);
    return { ...quote, symbol: symbol.toUpperCase() };
  }

  /**
   * Fetch recent news articles for one or more symbols.
   */
  async getNews(symbols: string[], limit: number = 10): Promise<AlpacaNewsArticle[]> {
    const qs = new URLSearchParams({
      symbols: symbols.map((s) => s.toUpperCase()).join(","),
      limit: String(limit),
    });
    const data = await this.request<{ news: AlpacaNewsArticle[] }>(
      this.dataBase,
      `/v2/news?${qs.toString()}`
    );
    return data.news ?? [];
  }

  // ─── Market clock ─────────────────────────────────────────────────────────

  async getClock(): Promise<{ is_open: boolean; next_open: string; next_close: string }> {
    return this.request(this.brokerBase, "/v2/clock");
  }
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class AlpacaError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
    public readonly path: string
  ) {
    super(`Alpaca API error ${status} ${statusText} at ${path}: ${body}`);
    this.name = "AlpacaError";
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

// ─── Risk gate ────────────────────────────────────────────────────────────────

export interface RiskCheckInput {
  /** Proposed notional (USD) to invest in a single position. */
  proposedNotional: number;
  /** Current total portfolio equity from Alpaca account. */
  portfolioEquity: number;
  /** Max fraction of portfolio allowed per position (e.g. 0.20 = 20%). */
  maxPositionPct: number;
  /** Total realized+unrealized loss today (positive number = loss). */
  todayLossUsd: number;
  /** Max allowed daily loss in USD before all trading stops. */
  dailyLossCapUsd: number;
  /** Must be false to allow live orders. */
  isLiveMode: boolean;
  /** Set to true during tests to simulate live mode without real credentials. */
  allowLiveInTest?: boolean;
}

export interface RiskCheckResult {
  approved: boolean;
  reason: string;
}

/**
 * Stateless risk gate — returns approval decision without side effects.
 * The trade-executor agent calls this before placing any order.
 */
export function checkRisk(input: RiskCheckInput): RiskCheckResult {
  if (input.isLiveMode && !input.allowLiveInTest) {
    return { approved: false, reason: "Live trading is disabled. Set ALPACA_MODE=live to enable." };
  }

  if (input.todayLossUsd >= input.dailyLossCapUsd) {
    return {
      approved: false,
      reason: `Daily loss cap reached: $${input.todayLossUsd.toFixed(2)} >= cap $${input.dailyLossCapUsd.toFixed(2)}. No more trades today.`,
    };
  }

  const maxAllowed = input.portfolioEquity * input.maxPositionPct;
  if (input.proposedNotional > maxAllowed) {
    return {
      approved: false,
      reason: `Position size $${input.proposedNotional.toFixed(2)} exceeds max allowed $${maxAllowed.toFixed(2)} (${(input.maxPositionPct * 100).toFixed(0)}% of $${input.portfolioEquity.toFixed(2)} equity).`,
    };
  }

  return { approved: true, reason: "Risk checks passed." };
}
