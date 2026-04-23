import type { ToolDefinition } from "@/lib/llm";
import { getUserIntegration, getPortfolioPositions } from "@/lib/db/user-trading-queries";
import { KrakenClient, KrakenError, DEFAULT_PAIRS, usdToVolume } from "@/lib/integrations/kraken";
import { BaseTool, type ToolExecutionContext, registerToolCategory } from "./base-tool";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("tools.kraken-tools");

export const KRAKEN_TOOL_NAMES = {
  BALANCE:       "builtin.kraken_balance",
  TICKER:        "builtin.kraken_ticker",
  OHLC:          "builtin.kraken_ohlc",
  PLACE_ORDER:   "builtin.kraken_place_order",
  CANCEL_ORDER:  "builtin.kraken_cancel_order",
  OPEN_ORDERS:   "builtin.kraken_open_orders",
  CLOSED_ORDERS: "builtin.kraken_closed_orders",
  PORTFOLIO:     "builtin.kraken_portfolio",
} as const;

export const KRAKEN_TOOLS_REQUIRING_APPROVAL: string[] = [
  KRAKEN_TOOL_NAMES.PLACE_ORDER,
  KRAKEN_TOOL_NAMES.CANCEL_ORDER,
];

export const BUILTIN_KRAKEN_TOOLS: ToolDefinition[] = [
  {
    name: KRAKEN_TOOL_NAMES.BALANCE,
    description:
      "Fetch your Kraken account balances. Returns all asset balances (e.g. ZUSD, XXBT, XETH) and a convenience usdBalance field. Requires Kraken API credentials to be configured in Settings → Integrations.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: KRAKEN_TOOL_NAMES.TICKER,
    description:
      "Fetch live ticker data (last price, ask, bid, 24h volume, 24h high/low) for one or more Kraken trading pairs. If no pairs are specified, returns tickers for the default watch list.",
    inputSchema: {
      type: "object",
      properties: {
        pairs: {
          type: "array",
          items: { type: "string" },
          description: `Trading pairs to look up (e.g. ["XBTUSD", "ETHUSD"]). Defaults to ${JSON.stringify(DEFAULT_PAIRS)} if omitted.`,
        },
      },
      required: [],
    },
  },
  {
    name: KRAKEN_TOOL_NAMES.OHLC,
    description:
      "Fetch OHLC (candlestick) price data for a trading pair. Useful for trend analysis. Returns up to the last 720 candles.",
    inputSchema: {
      type: "object",
      properties: {
        pair: {
          type: "string",
          description: "Kraken trading pair, e.g. \"XBTUSD\".",
        },
        interval: {
          type: "number",
          description: "Candle interval in minutes. Allowed values: 1, 5, 15, 30, 60, 240, 1440 (1 day). Defaults to 1440.",
        },
        limit: {
          type: "number",
          description: "Number of most-recent candles to return (1–100). Defaults to 30.",
        },
      },
      required: ["pair"],
    },
  },
  {
    name: KRAKEN_TOOL_NAMES.PLACE_ORDER,
    description:
      "Place a buy or sell order on Kraken. For market orders, specify volume in USD using volumeUsd and the tool will calculate the base currency amount. For precise volume control, use volumeBase directly. Requires Kraken API credentials. This action executes a real trade.",
    inputSchema: {
      type: "object",
      properties: {
        pair: {
          type: "string",
          description: "Kraken trading pair, e.g. \"XBTUSD\".",
        },
        side: {
          type: "string",
          enum: ["buy", "sell"],
          description: "Order direction.",
        },
        ordertype: {
          type: "string",
          enum: ["market", "limit"],
          description: "Order type. Defaults to \"market\".",
        },
        volumeUsd: {
          type: "number",
          description: "Order size in USD. The tool will fetch the current price and convert to base currency volume automatically. Use this for market orders.",
        },
        volumeBase: {
          type: "string",
          description: "Order size in base currency (e.g. 0.001 for 0.001 XBT). Takes precedence over volumeUsd if both are provided.",
        },
        price: {
          type: "string",
          description: "Limit price (required for limit orders, ignored for market orders).",
        },
      },
      required: ["pair", "side"],
    },
  },
  {
    name: KRAKEN_TOOL_NAMES.CANCEL_ORDER,
    description:
      "Cancel an open order on Kraken by its transaction ID (txid). The txid is returned by builtin.kraken_place_order or builtin.kraken_open_orders.",
    inputSchema: {
      type: "object",
      properties: {
        txid: {
          type: "string",
          description: "Kraken transaction ID of the order to cancel.",
        },
      },
      required: ["txid"],
    },
  },
  {
    name: KRAKEN_TOOL_NAMES.OPEN_ORDERS,
    description:
      "List all currently open (unfilled) orders on Kraken.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: KRAKEN_TOOL_NAMES.CLOSED_ORDERS,
    description:
      "List recently closed (filled or cancelled) orders on Kraken.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "number",
          description: "Optional Unix timestamp. Only return orders closed after this time.",
        },
      },
      required: [],
    },
  },
  {
    name: KRAKEN_TOOL_NAMES.PORTFOLIO,
    description:
      "Return the current portfolio positions tracked in Nexus (pair, quantity held, average entry price). This is the local record updated by the trading batch job — it may differ from Kraken's ledger if orders were placed outside Nexus.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

function getStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function getNumberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export class KrakenTools extends BaseTool {
  readonly name = "kraken";
  readonly toolNamePrefix = "builtin.kraken_";
  readonly registrationOrder = 60;
  readonly tools = BUILTIN_KRAKEN_TOOLS;
  readonly toolsRequiringApproval = [...KRAKEN_TOOLS_REQUIRING_APPROVAL];

  private getClient(userId: string): KrakenClient {
    const integration = getUserIntegration(userId, "kraken");
    if (!integration) {
      throw new Error(
        "No Kraken API credentials configured. Go to Settings → Integrations and add your Kraken API key and secret.",
      );
    }
    return new KrakenClient(integration.api_key, integration.api_secret);
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    const userId = context.userId ?? "";
    if (!userId) {
      throw new Error("Kraken tools require an authenticated user.");
    }

    const t0 = Date.now();
    log.enter("execute", { toolName, userId });

    try {
      let result: unknown;
      switch (toolName) {
        case KRAKEN_TOOL_NAMES.BALANCE:       result = await this.executeBalance(userId); break;
        case KRAKEN_TOOL_NAMES.TICKER:        result = await this.executeTicker(args, userId); break;
        case KRAKEN_TOOL_NAMES.OHLC:          result = await this.executeOhlc(args, userId); break;
        case KRAKEN_TOOL_NAMES.PLACE_ORDER:   result = await this.executePlaceOrder(args, userId); break;
        case KRAKEN_TOOL_NAMES.CANCEL_ORDER:  result = await this.executeCancelOrder(args, userId); break;
        case KRAKEN_TOOL_NAMES.OPEN_ORDERS:   result = await this.executeOpenOrders(userId); break;
        case KRAKEN_TOOL_NAMES.CLOSED_ORDERS: result = await this.executeClosedOrders(args, userId); break;
        case KRAKEN_TOOL_NAMES.PORTFOLIO:     result = this.executePortfolio(userId); break;
        default: throw new Error(`Unknown Kraken tool: ${toolName}`);
      }
      log.exit("execute", { toolName }, Date.now() - t0);
      return result;
    } catch (err) {
      if (err instanceof KrakenError && err.isAuthError) {
        throw new Error(
          `Kraken authentication failed. Check your API key and secret in Settings → Integrations. Detail: ${err.message}`,
        );
      }
      throw err;
    }
  }

  private async executeBalance(userId: string): Promise<unknown> {
    const client = this.getClient(userId);
    const balance = await client.getBalance();
    const usdBalance = parseFloat(balance["ZUSD"] ?? "0");
    return { usdBalance, balances: balance };
  }

  private async executeTicker(args: Record<string, unknown>, userId: string): Promise<unknown> {
    const client = this.getClient(userId);
    const rawPairs = Array.isArray(args.pairs) ? args.pairs.filter((p): p is string => typeof p === "string") : [];
    const pairs = rawPairs.length > 0 ? rawPairs : [...DEFAULT_PAIRS];
    const tickers = await client.getTicker(pairs);
    return { count: tickers.length, tickers };
  }

  private async executeOhlc(args: Record<string, unknown>, userId: string): Promise<unknown> {
    const client = this.getClient(userId);
    const pair = getStringArg(args, "pair");
    if (!pair) throw new Error("Missing required arg: pair");
    const interval = getNumberArg(args, "interval") ?? 1440;
    const limit = Math.min(100, Math.max(1, getNumberArg(args, "limit") ?? 30));
    const candles = await client.getOHLC(pair, interval);
    return { pair, interval, count: Math.min(limit, candles.length), candles: candles.slice(-limit) };
  }

  private async executePlaceOrder(args: Record<string, unknown>, userId: string): Promise<unknown> {
    const client = this.getClient(userId);
    const pair = getStringArg(args, "pair");
    const side = getStringArg(args, "side") as "buy" | "sell";
    const ordertype = (getStringArg(args, "ordertype") || "market") as "market" | "limit";
    const price = getStringArg(args, "price");

    if (!pair) throw new Error("Missing required arg: pair");
    if (side !== "buy" && side !== "sell") throw new Error("side must be 'buy' or 'sell'");

    let volume = getStringArg(args, "volumeBase");
    if (!volume) {
      const volumeUsd = getNumberArg(args, "volumeUsd");
      if (!volumeUsd || volumeUsd <= 0) {
        throw new Error("Provide either volumeBase (base currency amount) or volumeUsd (USD amount).");
      }
      const tickers = await client.getTicker([pair]);
      const lastPrice = parseFloat(tickers[0]?.last ?? "0");
      if (lastPrice <= 0) throw new Error(`Could not determine current price for ${pair}.`);
      volume = usdToVolume(volumeUsd, lastPrice);
    }

    const order = await client.placeOrder({ pair, type: side, ordertype, volume, price: price || undefined });
    return {
      status: "placed",
      txid: order.txid,
      description: order.descr.order,
      pair,
      side,
      ordertype,
      volume,
    };
  }

  private async executeCancelOrder(args: Record<string, unknown>, userId: string): Promise<unknown> {
    const client = this.getClient(userId);
    const txid = getStringArg(args, "txid");
    if (!txid) throw new Error("Missing required arg: txid");
    await client.cancelOrder(txid);
    return { status: "cancelled", txid };
  }

  private async executeOpenOrders(userId: string): Promise<unknown> {
    const client = this.getClient(userId);
    const orders = await client.getOpenOrders();
    return { count: orders.length, orders };
  }

  private async executeClosedOrders(args: Record<string, unknown>, userId: string): Promise<unknown> {
    const client = this.getClient(userId);
    const since = getNumberArg(args, "since");
    const orders = await client.getClosedOrders(since);
    return { count: orders.length, orders };
  }

  private executePortfolio(userId: string): unknown {
    const positions = getPortfolioPositions(userId, "kraken");
    return { count: positions.length, positions };
  }
}

export const krakenTools = new KrakenTools();
export const isKrakenTool = (name: string): boolean => name.startsWith("builtin.kraken_");
export const executeBuiltinKrakenTool = krakenTools.execute.bind(krakenTools);

registerToolCategory(krakenTools);
