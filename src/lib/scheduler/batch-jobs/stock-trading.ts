import {
  createThread,
  getSchedulerScheduleById,
} from "@/lib/db";
import {
  BatchJob,
  type BatchJobParameterDefinition,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";
import { OrchestratorAgent, AgentRegistry } from "@/lib/agent/multi-agent";
import { STOCK_TRADING_TASK_PROMPT } from "@/lib/prompts";
import { env } from "@/lib/env";

export class StockTradingBatchJob extends BatchJob {
  readonly type = "stock_trading" as const;
  readonly defaultName = "Stock Trading Pipeline";
  readonly defaultTriggerType = "cron" as const;
  /** Weekdays at 9:45 AM ET (14:45 UTC) — 15 minutes after market open. */
  readonly defaultTriggerExpr = "45 14 * * 1-5";

  canExecuteHandler(handlerName: string): boolean {
    return handlerName === "workflow.stock_trading.run";
  }

  getHandlerNames(): string[] {
    return ["workflow.stock_trading.run"];
  }

  override getParameterDefinitions(): BatchJobParameterDefinition[] {
    return [
      {
        key: "mode",
        label: "Trading Mode",
        type: "select",
        options: ["paper", "live"],
        defaultValue: "paper",
      },
      {
        key: "maxPositionPct",
        label: "Max Position Size (% of equity)",
        type: "select",
        options: ["5", "10", "15", "20", "25"],
        defaultValue: "20",
      },
      {
        key: "stopLossPct",
        label: "Stop-Loss Threshold (%)",
        type: "select",
        options: ["3", "5", "7", "10"],
        defaultValue: "5",
      },
      {
        key: "dailyLossCap",
        label: "Daily Loss Cap (USD)",
        type: "select",
        options: ["5", "10", "15", "20", "25"],
        defaultValue: "10",
      },
      {
        key: "maxIterations",
        label: "Max Agent Iterations",
        type: "select",
        options: ["10", "15", "20", "25"],
        defaultValue: "20",
      },
    ];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const { taskRunId, runId, handlerName, configJson, scheduleId } = ctx;
    const logCtx = { scheduleId, runId, taskRunId, handlerName };

    let userId = "";
    let maxIterations: number | undefined;
    let mode: string = env.ALPACA_MODE;
    let maxPositionPct = 0.2;
    let stopLossPct = 0.05;
    let dailyLossCapUsd = 10;
    const threadId = ctx.pipelineThreadId ?? "";

    try {
      const parsed = JSON.parse(configJson || "{}");
      if (typeof parsed.userId === "string" && parsed.userId) userId = parsed.userId;
      if (typeof parsed.maxIterations === "number" && parsed.maxIterations > 0) maxIterations = parsed.maxIterations;
      if (parsed.mode === "live" || parsed.mode === "paper") mode = parsed.mode;
      if (typeof parsed.maxPositionPct === "number") maxPositionPct = parsed.maxPositionPct / 100;
      if (typeof parsed.stopLossPct === "number") stopLossPct = parsed.stopLossPct / 100;
      if (typeof parsed.dailyLossCap === "number") dailyLossCapUsd = parsed.dailyLossCap;
    } catch { /* use defaults */ }

    if (!userId) {
      const schedule = getSchedulerScheduleById(scheduleId);
      userId = schedule?.owner_id ?? "";
    }
    if (!userId) {
      throw new Error("Missing userId for stock trading job. Set schedule owner_id.");
    }

    // Hard guard: live mode requires explicit env var — config alone is not enough.
    if (mode === "live" && env.ALPACA_MODE !== "live") {
      log("warning", "Live mode requested in config but ALPACA_MODE env var is not 'live'. Falling back to paper.", logCtx);
      mode = "paper";
    }

    let runThreadId = threadId;
    if (!runThreadId) {
      const schedule = getSchedulerScheduleById(scheduleId);
      const title = schedule ? `Stock Trading: ${schedule.name}` : "Stock Trading";
      runThreadId = createThread(title, userId, { threadType: "scheduled" }).id;
      log("info", "Created pipeline thread for stock trading run.", logCtx, { threadId: runThreadId });
    }

    const additionalContext = [
      `## Trading configuration`,
      `- Mode: ${mode}`,
      `- Max position size: ${(maxPositionPct * 100).toFixed(0)}% of equity`,
      `- Stop-loss threshold: ${(stopLossPct * 100).toFixed(0)}%`,
      `- Daily loss cap: $${dailyLossCapUsd}`,
      `- Live trading authorized: ${mode === "live" ? "YES — real money" : "NO — paper only"}`,
      ``,
      `## Default watchlist (expand or override via knowledge vault)`,
      `AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META, SPY, QQQ`,
    ].join("\n");

    const registry = AgentRegistry.getInstance();
    const orchestrator = new OrchestratorAgent(registry);

    log("info", `Starting stock trading cycle. Mode=${mode}, maxPositionPct=${maxPositionPct}, stopLossPct=${stopLossPct}, dailyLossCap=$${dailyLossCapUsd}`, logCtx);

    const result = await orchestrator.run(
      STOCK_TRADING_TASK_PROMPT,
      { userId, threadId: runThreadId, maxIterations, additionalContext },
    );

    log("info", "Stock trading orchestration completed.", logCtx, {
      threadId: result.threadId,
      agentsDispatched: result.agentsDispatched,
      toolsUsed: result.toolsUsed,
      response: result.response.slice(0, 500),
    });

    return {
      pipelineThreadId: result.threadId,
      outputJson: {
        kind: "stock_trading_orchestrated",
        threadId: result.threadId,
        userId,
        mode,
        agentsDispatched: result.agentsDispatched,
        toolsUsed: result.toolsUsed,
        response: result.response,
      },
    };
  }

  protected createDefaultTasks(parameters: Record<string, string> = {}): BatchJobSubTaskTemplate[] {
    const maxIterations = parameters.maxIterations ? Number(parameters.maxIterations) : 20;
    const mode = parameters.mode ?? "paper";
    const maxPositionPct = parameters.maxPositionPct ? Number(parameters.maxPositionPct) : 20;
    const stopLossPct = parameters.stopLossPct ? Number(parameters.stopLossPct) : 5;
    const dailyLossCap = parameters.dailyLossCap ? Number(parameters.dailyLossCap) : 10;

    return [
      {
        task_key: "run",
        name: "Stock Trading Cycle",
        handler_name: "workflow.stock_trading.run",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
        config_json: { maxIterations, mode, maxPositionPct, stopLossPct, dailyLossCap },
        task_type: "orchestrator.call",
        agent_name: "stock-trading-orchestrator",
        input_schema: {
          type: "object",
          properties: {
            maxIterations: { type: "number" },
            mode: { type: "string", enum: ["paper", "live"] },
            maxPositionPct: { type: "number" },
            stopLossPct: { type: "number" },
            dailyLossCap: { type: "number" },
            userId: { type: "string" },
          },
          required: [],
        },
        output_schema: {
          type: "object",
          properties: {
            kind: { type: "string" },
            threadId: { type: "string" },
            mode: { type: "string" },
            agentsDispatched: { type: "array" },
          },
          required: ["kind", "threadId", "mode"],
        },
        input_values: { maxIterations, mode, maxPositionPct, stopLossPct, dailyLossCap },
      },
    ];
  }
}
