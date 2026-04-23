import { createThread, getSchedulerScheduleById } from "@/lib/db";
import { createNotification } from "@/lib/db/notification-queries";
import {
  getUserIntegration,
  insertTradeLog,
  getTodayTrades,
  getTodayLossUsd,
  getPortfolioPositions,
  upsertPortfolioPosition,
} from "@/lib/db/user-trading-queries";
import {
  KrakenClient,
  KrakenError,
  checkTradeRisk,
  usdToVolume,
  DEFAULT_PAIRS,
  type TradingRisk,
} from "@/lib/integrations/kraken";
import { OrchestratorAgent, AgentRegistry } from "@/lib/agent/multi-agent";
import { TRADING_CYCLE_PROMPT, TRADING_DAILY_SUMMARY_PROMPT } from "@/lib/prompts";
import {
  BatchJob,
  type BatchJobParameterDefinition,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";

const MIN_TRADE_USD = 10;
const DEFAULT_MAX_POSITION_PCT = 0.25;
const DEFAULT_STOP_LOSS_PCT = 0.10;
const DEFAULT_DAILY_LOSS_CAP_USD = 50;

interface TradeRecommendation {
  pair: string;
  side: "buy" | "sell";
  volume_usd: number;
  score: number;
  reasoning: string;
}

interface OrchestratorRecommendations {
  recommendations: TradeRecommendation[];
  skip: boolean;
  skip_reason: string | null;
}

function parseRecommendations(response: string): OrchestratorRecommendations | null {
  const match = response.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as OrchestratorRecommendations;
  } catch {
    return null;
  }
}

export class TradingBatchJob extends BatchJob {
  readonly type = "trading" as const;
  readonly defaultName = "Crypto Trading";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:6:hour";

  canExecuteHandler(handlerName: string): boolean {
    return handlerName === "workflow.trading.run" || handlerName === "workflow.trading.daily_summary";
  }

  getHandlerNames(): string[] {
    return ["workflow.trading.run", "workflow.trading.daily_summary"];
  }

  override getParameterDefinitions(): BatchJobParameterDefinition[] {
    return [
      {
        key: "maxPositionPct",
        label: "Max Position % of Balance",
        type: "select",
        options: ["10", "15", "25", "33", "50"],
        defaultValue: "25",
      },
      {
        key: "dailyLossCapUsd",
        label: "Daily Loss Cap (USD)",
        type: "select",
        options: ["20", "50", "100", "200"],
        defaultValue: "50",
      },
      {
        key: "stopLossPct",
        label: "Stop-Loss %",
        type: "select",
        options: ["5", "10", "15", "20"],
        defaultValue: "10",
      },
    ];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const { taskRunId, runId, handlerName, configJson, scheduleId } = ctx;
    const logCtx = { scheduleId, runId, taskRunId, handlerName };

    let userId = "";
    let maxPositionPct = DEFAULT_MAX_POSITION_PCT;
    let dailyLossCapUsd = DEFAULT_DAILY_LOSS_CAP_USD;
    let stopLossPct = DEFAULT_STOP_LOSS_PCT;
    const threadId = ctx.pipelineThreadId ?? "";

    try {
      const parsed = JSON.parse(configJson || "{}");
      if (typeof parsed.userId === "string" && parsed.userId) userId = parsed.userId;
      if (typeof parsed.maxPositionPct === "number") maxPositionPct = parsed.maxPositionPct / 100;
      if (typeof parsed.dailyLossCapUsd === "number") dailyLossCapUsd = parsed.dailyLossCapUsd;
      if (typeof parsed.stopLossPct === "number") stopLossPct = parsed.stopLossPct / 100;
    } catch { /* use defaults */ }

    if (!userId) {
      const schedule = getSchedulerScheduleById(scheduleId);
      userId = schedule?.owner_id ?? "";
    }
    if (!userId) {
      throw new Error("Missing userId for trading job. Set schedule owner_id.");
    }

    let runThreadId = threadId;
    if (!runThreadId) {
      const schedule = getSchedulerScheduleById(scheduleId);
      const title = schedule ? `Trading: ${schedule.name}` : "Trading";
      runThreadId = createThread(title, userId, { threadType: "scheduled" }).id;
      log("info", "Created pipeline thread for trading run.", logCtx, { threadId: runThreadId });
    }

    if (handlerName === "workflow.trading.daily_summary") {
      return this.runDailySummary(userId, runThreadId, logCtx, log);
    }

    return this.runTradingCycle(userId, runThreadId, maxPositionPct, dailyLossCapUsd, stopLossPct, logCtx, log);
  }

  private async runTradingCycle(
    userId: string,
    threadId: string,
    maxPositionPct: number,
    dailyLossCapUsd: number,
    stopLossPct: number,
    logCtx: Record<string, string | undefined>,
    log: LogFn,
  ): Promise<StepExecutionResult> {
    // Load per-user Kraken credentials.
    const integration = getUserIntegration(userId, "kraken");
    if (!integration) {
      createNotification({
        userId,
        type: "warning",
        title: "Trading paused — no Kraken API credentials configured.",
        body: "Add your Kraken API key and secret in Settings → Integrations to enable automated crypto trading.",
      });
      log("warning", "No Kraken credentials for user. Skipping trading cycle.", logCtx);
      return { outputJson: { kind: "trading_skipped", reason: "no_credentials" } };
    }

    const kraken = new KrakenClient(integration.api_key, integration.api_secret);

    // Check USD balance.
    let balanceUsd = 0;
    try {
      balanceUsd = await kraken.getUsdBalance();
    } catch (err) {
      const msg = err instanceof KrakenError ? err.message : String(err);
      log("error", "Failed to fetch Kraken balance.", logCtx, { error: msg });
      if (err instanceof KrakenError && err.isAuthError) {
        createNotification({
          userId,
          type: "system_error",
          title: "Trading error — Kraken authentication failed.",
          body: "Check your API key and secret in Settings → Integrations.",
        });
      }
      throw err;
    }

    const risk: TradingRisk = {
      balanceUsd,
      maxPositionPct,
      stopLossPct,
      dailyLossCapUsd,
      minTradeUsd: MIN_TRADE_USD,
    };

    if (balanceUsd < MIN_TRADE_USD) {
      createNotification({
        userId,
        type: "warning",
        title: `Trading stopped — balance too low ($${balanceUsd.toFixed(2)}).`,
        body: `Your Kraken USD balance ($${balanceUsd.toFixed(2)}) is below the minimum trade size ($${MIN_TRADE_USD}). Deposit funds to resume.`,
      });
      log("info", "Balance too low to trade. Stopping cycle.", logCtx, { balanceUsd });
      return { outputJson: { kind: "trading_stopped", reason: "balance_too_low", balanceUsd } };
    }

    const todayLossUsd = getTodayLossUsd(userId, "kraken");
    const dailyLossCheck = checkTradeRisk(MIN_TRADE_USD, todayLossUsd, risk);
    if (!dailyLossCheck.approved) {
      createNotification({
        userId,
        type: "warning",
        title: "Trading paused — daily loss cap reached.",
        body: dailyLossCheck.reason,
      });
      log("info", "Daily loss cap reached. Stopping cycle.", logCtx, { todayLossUsd });
      return { outputJson: { kind: "trading_stopped", reason: "daily_loss_cap", todayLossUsd } };
    }

    // Fetch market data for default pairs.
    const pairs = [...DEFAULT_PAIRS];
    let ohlcContext = "";
    let tickerContext = "";
    try {
      const [tickers, ...ohlcResults] = await Promise.all([
        kraken.getTicker(pairs),
        ...pairs.map((p) => kraken.getOHLC(p, 1440).then((candles) => ({ pair: p, candles: candles.slice(-7) }))),
      ]);
      tickerContext = tickers
        .map((t) => `${t.pair}: last=$${t.last}, ask=$${t.ask}, bid=$${t.bid}, 24h vol=${t.volume24h}, 24h high=$${t.high24h}, 24h low=$${t.low24h}`)
        .join("\n");
      ohlcContext = ohlcResults
        .map(({ pair, candles }) => {
          const rows = candles.map((c) => `  ${new Date(c.time * 1000).toISOString().slice(0, 10)}: O=${c.open} H=${c.high} L=${c.low} C=${c.close} V=${c.volume}`).join("\n");
          return `${pair} (last 7 daily candles):\n${rows}`;
        })
        .join("\n\n");
    } catch (err) {
      log("warning", "Failed to fetch market data. Proceeding with partial data.", logCtx, { error: String(err) });
    }

    // Fetch open portfolio positions.
    const positions = getPortfolioPositions(userId, "kraken");
    const positionsContext = positions.length > 0
      ? positions.map((p) => `${p.pair}: qty=${p.qty}, avgEntry=$${p.avg_entry_price}`).join("\n")
      : "No open positions.";

    // Build full context for orchestrator.
    const tradingContext = [
      `## Account\nUSD Balance: $${balanceUsd.toFixed(2)}`,
      `## Risk Parameters\n- Max position per trade: ${(maxPositionPct * 100).toFixed(0)}% of balance ($${(balanceUsd * maxPositionPct).toFixed(2)})\n- Stop-loss: ${(stopLossPct * 100).toFixed(0)}% unrealised loss\n- Daily loss cap: $${dailyLossCapUsd}\n- Minimum trade size: $${MIN_TRADE_USD}`,
      `## Open Positions\n${positionsContext}`,
      `## Live Ticker\n${tickerContext || "Unavailable."}`,
      `## OHLC Price Data\n${ohlcContext || "Unavailable."}`,
    ].join("\n\n");

    log("info", "Running trading cycle orchestrator.", logCtx, { balanceUsd, pairs });

    const registry = AgentRegistry.getInstance();
    const orchestrator = new OrchestratorAgent(registry);
    const result = await orchestrator.run(TRADING_CYCLE_PROMPT, {
      userId,
      threadId,
      additionalContext: tradingContext,
    });

    log("info", "Orchestrator returned trading recommendations.", logCtx, {
      response: result.response.slice(0, 500),
    });

    const parsed = parseRecommendations(result.response);
    if (!parsed) {
      log("warning", "Could not parse recommendations JSON from orchestrator response.", logCtx);
      return {
        pipelineThreadId: result.threadId,
        outputJson: { kind: "trading_cycle", skipped: true, reason: "no_json", response: result.response },
      };
    }

    if (parsed.skip) {
      log("info", "Orchestrator recommended skipping trades.", logCtx, { reason: parsed.skip_reason });
      return {
        pipelineThreadId: result.threadId,
        outputJson: { kind: "trading_cycle", skipped: true, reason: parsed.skip_reason },
      };
    }

    // Execute each recommended trade.
    const executed: string[] = [];
    const errors: string[] = [];

    for (const rec of parsed.recommendations) {
      const riskCheck = checkTradeRisk(rec.volume_usd, todayLossUsd, risk);
      if (!riskCheck.approved) {
        log("info", `Risk gate blocked trade: ${rec.pair} ${rec.side}.`, logCtx, { reason: riskCheck.reason });
        insertTradeLog({
          userId,
          scheduleRunId: logCtx.runId,
          provider: "kraken",
          pair: rec.pair,
          side: rec.side,
          volumeUsd: rec.volume_usd,
          status: "cancelled",
          reasoning: rec.reasoning,
          errorMessage: `Risk gate: ${riskCheck.reason}`,
        });
        continue;
      }

      // Get current price for volume calculation.
      let lastPrice = 0;
      try {
        const ticker = await kraken.getTicker([rec.pair]);
        lastPrice = parseFloat(ticker[0]?.last ?? "0");
      } catch {
        log("warning", `Could not fetch ticker for ${rec.pair}. Skipping trade.`, logCtx);
        continue;
      }

      if (lastPrice <= 0) continue;

      const volume = usdToVolume(rec.volume_usd, lastPrice);
      try {
        const order = await kraken.placeOrder({
          pair: rec.pair,
          type: rec.side,
          ordertype: "market",
          volume,
        });

        const txid = order.txid[0] ?? "";
        const tradeId = insertTradeLog({
          userId,
          scheduleRunId: logCtx.runId,
          exchangeOrderId: txid,
          provider: "kraken",
          pair: rec.pair,
          side: rec.side,
          qty: parseFloat(volume),
          volumeUsd: rec.volume_usd,
          fillPrice: lastPrice,
          status: "filled",
          reasoning: rec.reasoning,
        });

        // Update portfolio position.
        const existing = positions.find((p) => p.pair === rec.pair);
        if (rec.side === "buy") {
          const prevQty = existing?.qty ?? 0;
          const prevAvg = existing?.avg_entry_price ?? 0;
          const newQty = prevQty + parseFloat(volume);
          const newAvg = prevQty > 0
            ? (prevQty * prevAvg + parseFloat(volume) * lastPrice) / newQty
            : lastPrice;
          upsertPortfolioPosition(userId, "kraken", rec.pair, newQty, newAvg);
        } else {
          const newQty = Math.max(0, (existing?.qty ?? 0) - parseFloat(volume));
          upsertPortfolioPosition(userId, "kraken", rec.pair, newQty, existing?.avg_entry_price ?? 0);
        }

        executed.push(`${rec.side.toUpperCase()} ${rec.pair} $${rec.volume_usd} (score ${rec.score})`);
        log("info", `Trade executed: ${rec.side} ${rec.pair} vol=${volume} txid=${txid}`, logCtx, { tradeId });
      } catch (err) {
        const msg = err instanceof KrakenError ? err.message : String(err);
        errors.push(`${rec.pair}: ${msg}`);
        log("error", `Trade failed: ${rec.side} ${rec.pair}.`, logCtx, { error: msg });
        insertTradeLog({
          userId,
          scheduleRunId: logCtx.runId,
          provider: "kraken",
          pair: rec.pair,
          side: rec.side,
          volumeUsd: rec.volume_usd,
          status: "error",
          reasoning: rec.reasoning,
          errorMessage: msg,
        });

        if (err instanceof KrakenError && err.isInsufficientFunds) {
          createNotification({
            userId,
            type: "system_error",
            title: `Trade failed — insufficient funds for ${rec.pair}.`,
            body: msg,
          });
        }
      }
    }

    // Notify for significant outcomes (any executed trades or errors).
    if (executed.length > 0) {
      createNotification({
        userId,
        type: "info",
        title: `${executed.length} crypto trade${executed.length > 1 ? "s" : ""} executed.`,
        body: executed.join("; "),
      });
    }
    if (errors.length > 0) {
      createNotification({
        userId,
        type: "system_error",
        title: `${errors.length} trade error${errors.length > 1 ? "s" : ""} during trading cycle.`,
        body: errors.join("; "),
      });
    }

    return {
      pipelineThreadId: result.threadId,
      outputJson: {
        kind: "trading_cycle",
        skipped: false,
        tradesExecuted: executed.length,
        tradeErrors: errors.length,
        executed,
        errors,
      },
    };
  }

  private async runDailySummary(
    userId: string,
    threadId: string,
    logCtx: Record<string, string | undefined>,
    log: LogFn,
  ): Promise<StepExecutionResult> {
    const integration = getUserIntegration(userId, "kraken");
    const trades = getTodayTrades(userId, "kraken");

    let balanceContext = "Balance unavailable (no credentials configured).";
    let positionsContext = "No open positions.";

    if (integration) {
      try {
        const kraken = new KrakenClient(integration.api_key, integration.api_secret);
        const balanceUsd = await kraken.getUsdBalance();
        balanceContext = `Current USD balance: $${balanceUsd.toFixed(2)}`;
        const positions = getPortfolioPositions(userId, "kraken");
        if (positions.length > 0) {
          positionsContext = positions.map((p) => `${p.pair}: qty=${p.qty}, avgEntry=$${p.avg_entry_price}`).join("\n");
        }
      } catch (err) {
        log("warning", "Could not fetch balance for daily summary.", logCtx, { error: String(err) });
      }
    }

    const tradeLines = trades.length > 0
      ? trades.map((t) =>
          `${t.side.toUpperCase()} ${t.pair}: vol=$${t.volumeUsd ?? "?"}, fill=$${t.fillPrice ?? "?"}, status=${t.status}, reasoning="${t.reasoning ?? ""}"`
        ).join("\n")
      : "No trades executed today.";

    const summaryContext = [
      `## Today's Trades\n${tradeLines}`,
      `## Account\n${balanceContext}`,
      `## Open Positions\n${positionsContext}`,
    ].join("\n\n");

    log("info", "Running daily summary orchestrator.", logCtx, { tradeCount: trades.length });

    const registry = AgentRegistry.getInstance();
    const orchestrator = new OrchestratorAgent(registry);
    const result = await orchestrator.run(TRADING_DAILY_SUMMARY_PROMPT, {
      userId,
      threadId,
      additionalContext: summaryContext,
    });

    log("info", "Daily summary orchestrator completed.", logCtx, {
      agentsDispatched: result.agentsDispatched,
      toolsUsed: result.toolsUsed,
    });

    return {
      pipelineThreadId: result.threadId,
      outputJson: {
        kind: "trading_daily_summary",
        tradeCount: trades.length,
        agentsDispatched: result.agentsDispatched,
        toolsUsed: result.toolsUsed,
      },
    };
  }

  protected createDefaultTasks(parameters: Record<string, string> = {}): BatchJobSubTaskTemplate[] {
    const maxPositionPct = parameters.maxPositionPct ? Number(parameters.maxPositionPct) : 25;
    const dailyLossCapUsd = parameters.dailyLossCapUsd ? Number(parameters.dailyLossCapUsd) : 50;
    const stopLossPct = parameters.stopLossPct ? Number(parameters.stopLossPct) : 10;

    return [
      {
        task_key: "trading_cycle",
        name: "Trading Cycle",
        handler_name: "workflow.trading.run",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
        config_json: { maxPositionPct, dailyLossCapUsd, stopLossPct },
        task_type: "orchestrator.call",
        agent_name: "crypto-market-analyst",
        input_schema: {
          type: "object",
          properties: {
            userId: { type: "string" },
            maxPositionPct: { type: "number" },
            dailyLossCapUsd: { type: "number" },
            stopLossPct: { type: "number" },
          },
          required: [],
        },
        output_schema: {
          type: "object",
          properties: {
            tradesExecuted: { type: "number" },
            skipped: { type: "boolean" },
          },
          required: ["skipped"],
        },
        input_values: { maxPositionPct, dailyLossCapUsd, stopLossPct },
      },
      {
        task_key: "daily_summary",
        name: "Daily Summary Email",
        handler_name: "workflow.trading.daily_summary",
        execution_mode: "sync",
        sequence_no: 1,
        enabled: 0,
        config_json: {},
        task_type: "orchestrator.call",
        agent_name: "crypto-market-analyst",
        input_schema: {
          type: "object",
          properties: { userId: { type: "string" } },
          required: [],
        },
        output_schema: {
          type: "object",
          properties: { tradeCount: { type: "number" } },
          required: ["tradeCount"],
        },
        input_values: {},
      },
    ];
  }
}
