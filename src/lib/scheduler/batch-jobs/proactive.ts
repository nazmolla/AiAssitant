/**
 * Proactive Batch Job
 *
 * Owns all proactive scan logic:
 * - Prompt building for the proactive LLM agent
 * - Exploration strategy (novelty tracking, follow-up scans)
 * - Scan execution with mutex protection
 *
 * Called by:
 * - Unified scheduler engine via ProactiveBatchJob.executeStep()
 */

import { getMcpManager } from "@/lib/mcp";
import { getCustomToolDefinitions } from "@/lib/tools/custom-tools";
import {
  getToolPolicy,
  addLog,
  createThread,
  getAppConfig,
  setAppConfig,
} from "@/lib/db";
import {
  type SchedulerBatchExecutionContext,
  getDefaultAdminUserId,
  mergeBatchContext,
} from "@/lib/scheduler/shared";
import {
  buildProactiveScanMessagePrompt,
  buildExplorationFollowupMessagePrompt,
  PROACTIVE_PRIMARY_TASK_PROMPT,
  PROACTIVE_FOLLOWUP_TASK_PROMPT,
} from "@/lib/prompts";
import {
  BatchJob,
  type BatchJobParameterDefinition,
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";

// ── Proactive Scan Types & State ──────────────────────────────────

export interface ProactiveScanIterationSummary {
  iteration: number;
  threadId: string;
  toolsUsed: string[];
  newToolsCount: number;
  /** Why this iteration was the last one. */
  stopReason?: "coverage_met" | "stagnation" | "max_iterations";
}

export interface ProactiveScanResult {
  primaryThreadId: string;
  /** Last follow-up thread ID (backward-compat alias for iterations[last].threadId). */
  followupThreadId?: string;
  toolsUsed: string[];
  /** How many iterations actually ran. */
  iterationCount: number;
  /** Per-iteration breakdown (tools used, new tools, stop reason). */
  iterations: ProactiveScanIterationSummary[];
}

/* ── Batch Job Class ──────────────────────────────────────────────── */

export class ProactiveBatchJob extends BatchJob {
  readonly type = "proactive" as const;
  readonly defaultName = "Proactive Batch";
  readonly defaultTriggerType = "interval" as const;
  readonly defaultTriggerExpr = "every:10:minute";

  private static _scanRunning = false;

  // ── Helper Methods ────────────────────────────────────

  private static buildProactiveScanMessage(
    connectedServers: string[],
    mcpToolCount: number,
    customToolNames: string[],
    lastToolsUsed: string[],
    mustTryTools: string[]
  ): string {
    return buildProactiveScanMessagePrompt(
      connectedServers,
      mcpToolCount,
      customToolNames,
      lastToolsUsed,
      mustTryTools,
    );
  }

  private static getToolCategory(toolName: string): "network" | "camera" | "occupancy" | "toolmaker" | "other" {
    if (/net_scan_network|net_scan_ports|net_http_request|nmap|network/i.test(toolName)) return "network";
    if (/camera|wyze|rtsp|onvif|hass.*camera/i.test(toolName)) return "camera";
    if (/motion|occupancy|presence|room|hass.*sensor|wifi/i.test(toolName)) return "occupancy";
    if (/nexus_create_tool|nexus_update_tool|custom\./i.test(toolName)) return "toolmaker";
    return "other";
  }

  private static getLastProactiveTools(): string[] {
    const raw = getAppConfig("proactive_last_tools");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as string[];
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
    } catch {
      return [];
    }
  }

  private static setLastProactiveTools(tools: string[]): void {
    setAppConfig("proactive_last_tools", JSON.stringify(tools.slice(0, 24)));
  }

  private static buildMustTryTools(availableTools: string[], lastToolsUsed: string[]): string[] {
    const lastSet = new Set(lastToolsUsed);
    const candidates = availableTools.filter((t) => !lastSet.has(t));
    return candidates.slice(0, 6);
  }

  private static hasExplorationCategoryCoverage(toolsUsed: string[]): boolean {
    return toolsUsed.some((tool) => {
      const category = this.getToolCategory(tool);
      return category === "network" || category === "camera" || category === "occupancy";
    });
  }

  private static hasToolmakerCoverage(toolsUsed: string[]): boolean {
    return toolsUsed.some((tool) => this.getToolCategory(tool) === "toolmaker");
  }

  private static shouldRunExplorationFollowup(
    toolsUsed: string[],
    lastToolsUsed: string[],
    requireToolmakerAction: boolean,
  ): boolean {
    const hasNovelty = toolsUsed.some((t) => !lastToolsUsed.includes(t));
    const hasDepth = this.hasExplorationCategoryCoverage(toolsUsed);
    const hasMaintenance = this.hasToolmakerCoverage(toolsUsed);
    return !hasNovelty || !hasDepth || (requireToolmakerAction && !hasMaintenance);
  }

  private static buildExplorationFollowupMessage(connectedServers: string[], mustTryTools: string[]): string {
    return buildExplorationFollowupMessagePrompt(connectedServers, mustTryTools);
  }

  private static buildIterationFeedbackContext(
    currentIteration: number,
    maxScanIterations: number,
    priorIterations: ProactiveScanIterationSummary[],
    connectedServers: string[],
    mustTryTools: string[],
  ): string {
    const allToolsSoFar = [...new Set(priorIterations.flatMap((it) => it.toolsUsed))];
    const serverList = connectedServers.length > 0 ? connectedServers.join(", ") : "none";
    const prevSummary = priorIterations
      .map((it) => `- Iteration ${it.iteration}: ${it.toolsUsed.length} tool(s) called (${it.newToolsCount} new)`)
      .join("\n");
    const remaining = maxScanIterations - currentIteration;
    const untriedCandidates = mustTryTools.filter((t) => !allToolsSoFar.includes(t));

    return `[Proactive Scan — Iteration ${currentIteration}/${maxScanIterations}]

## Prior iterations
${prevSummary}

## Accumulated tool usage (${allToolsSoFar.length} distinct): ${allToolsSoFar.join(", ")}

## Remaining iteration budget: ${remaining} after this one
Connected servers: ${serverList}
Untried candidate tools: ${untriedCandidates.length > 0 ? untriedCandidates.join(", ") : "none — explore new areas"}

Focus on coverage gaps not addressed in prior iterations: network/camera/occupancy discovery and toolmaker actions. Do NOT repeat tools already used unless essential for new insight. Target unexplored paths.

**DEDUPLICATION RULE**: Do NOT send any channel_notify notification about a finding, device state, or insight that was already surfaced in a prior iteration of THIS scan session. Only notify about genuinely new discoveries not covered above.`;
  }

  // ── Main Execution ────────────────────────────────────

  private static async runProactiveScan(context?: SchedulerBatchExecutionContext, maxIterations?: number, scanIterations?: number): Promise<ProactiveScanResult | null> {
    if (this._scanRunning) {
      addLog({
        level: "info",
        source: "scheduler",
        message: "Skipping proactive scan — previous scan still running.",
        metadata: JSON.stringify(mergeBatchContext({}, context)),
      });
      return null;
    }
    this._scanRunning = true;

    try {
      return await this.runProactiveScanInner(maxIterations, scanIterations);
    } finally {
      this._scanRunning = false;
    }
  }

  private static async runProactiveScanInner(maxIterations?: number, scanIterations: number = 3): Promise<ProactiveScanResult> {
    const defaultAdminUserId = getDefaultAdminUserId();
    if (!defaultAdminUserId) {
      addLog({
        level: "warning",
        source: "scheduler",
        message: "Proactive scan aborted — no enabled admin user found.",
      });
      throw new Error("Proactive scan: no enabled admin user found.");
    }

    addLog({
      level: "info",
      source: "scheduler",
      message: "Proactive scan started.",
      metadata: JSON.stringify({ adminUserId: defaultAdminUserId, scanIterations }),
    });

    const mcpManager = getMcpManager();

    const connectedServers = mcpManager.getConnectedServerIds();
    const mcpTools = mcpManager.getAllTools();
    const customTools = getCustomToolDefinitions();
    const customToolNames = customTools.map((t) => t.name);
    const lastToolsUsed = this.getLastProactiveTools();
    const allVisibleTools = [
      ...mcpTools.map((t) => t.name),
      ...customToolNames,
    ];
    const requireToolmakerAction =
      allVisibleTools.some((name) => /nexus_create_tool|nexus_update_tool/i.test(name)) ||
      !!getToolPolicy("nexus_create_tool") ||
      !!getToolPolicy("nexus_update_tool");
    const noApprovalCandidates = mcpTools
      .map((t) => t.name)
      .filter((name) => {
        const policy = getToolPolicy(name);
        return policy ? policy.requires_approval === 0 : false;
      });
    const mustTryTools = this.buildMustTryTools(noApprovalCandidates, lastToolsUsed);

    addLog({
      level: "thought",
      source: "thought",
      message: `[Proactive] Starting iterative scan — ${connectedServers.length} MCP server(s) connected, ${mcpTools.length} tools available, up to ${scanIterations} iteration(s).`,
      metadata: JSON.stringify({
        connectedServers,
        mcpToolCount: mcpTools.length,
        customToolCount: customToolNames.length,
        scanIterations,
      }),
    });

    const { OrchestratorAgent, AgentRegistry } = await import("@/lib/agent/multi-agent");
    const registry = AgentRegistry.getInstance();

    const accumulatedTools = new Set<string>();
    const iterationSummaries: ProactiveScanIterationSummary[] = [];

    for (let i = 1; i <= scanIterations; i++) {
      const isFirst = i === 1;
      const threadLabel = isFirst ? "[proactive-scan]" : `[proactive-scan-iter-${i}]`;
      const thread = createThread(threadLabel, defaultAdminUserId, { threadType: "proactive" });

      const additionalContext = isFirst
        ? this.buildProactiveScanMessage(connectedServers, mcpTools.length, customToolNames, lastToolsUsed, mustTryTools)
        : this.buildIterationFeedbackContext(i, scanIterations, iterationSummaries, connectedServers, mustTryTools);
      const taskPrompt = isFirst ? PROACTIVE_PRIMARY_TASK_PROMPT : PROACTIVE_FOLLOWUP_TASK_PROMPT;

      const orchestrator = new OrchestratorAgent(registry);
      const result = await orchestrator.run(taskPrompt, {
        // Pass empty string so knowledge is stored as global (user_id=null) via the
        // `upsertKnowledge` normalization (empty string → null). Tool access defaults
        // to admin-level when userId is falsy. Thread creation uses defaultAdminUserId.
        userId: "",
        threadId: thread.id,
        additionalContext,
        maxIterations,
      });

      const newTools = result.toolsUsed.filter((t) => !accumulatedTools.has(t));
      result.toolsUsed.forEach((t) => accumulatedTools.add(t));

      const allToolsNow = Array.from(accumulatedTools);
      const coverageMet = !this.shouldRunExplorationFollowup(allToolsNow, lastToolsUsed, requireToolmakerAction);

      let stopReason: ProactiveScanIterationSummary["stopReason"] | undefined;
      if (coverageMet) stopReason = "coverage_met";
      else if (!isFirst && newTools.length === 0) stopReason = "stagnation";
      else if (i === scanIterations) stopReason = "max_iterations";

      const summary: ProactiveScanIterationSummary = {
        iteration: i,
        threadId: thread.id,
        toolsUsed: result.toolsUsed,
        newToolsCount: newTools.length,
        stopReason,
      };
      iterationSummaries.push(summary);

      addLog({
        level: "info",
        source: "scheduler",
        message: `[Proactive] Iteration ${i}/${scanIterations} complete — ${newTools.length} new tool(s), ${allToolsNow.length} total.${stopReason ? ` Stopping: ${stopReason}.` : ""}`,
        metadata: JSON.stringify({ iteration: i, scanIterations, newTools, allToolsCount: allToolsNow.length, stopReason }),
      });

      if (result.response) {
        addLog({
          level: "thought",
          source: "thought",
          message: `[Proactive] Iteration ${i} response:\n${result.response.slice(0, 2000)}`,
          metadata: JSON.stringify({ threadId: thread.id, full: result.response.length <= 2000 }),
        });
      }

      if (stopReason) break;
    }

    const finalToolsUsed = Array.from(accumulatedTools);
    this.setLastProactiveTools(finalToolsUsed);

    const primaryThreadId = iterationSummaries[0].threadId;
    const followupThreadId = iterationSummaries.length > 1
      ? iterationSummaries[iterationSummaries.length - 1].threadId
      : undefined;

    addLog({
      level: "info",
      source: "scheduler",
      message: "Proactive scan completed.",
      metadata: JSON.stringify({
        primaryThreadId,
        followupThreadId,
        iterationCount: iterationSummaries.length,
        toolsUsed: finalToolsUsed,
      }),
    });

    return {
      primaryThreadId,
      followupThreadId,
      toolsUsed: finalToolsUsed,
      iterationCount: iterationSummaries.length,
      iterations: iterationSummaries,
    };
  }

  canExecuteHandler(handlerName: string): boolean {
    return handlerName === "system.proactive.scan";
  }

  getHandlerNames(): string[] {
    return ["system.proactive.scan"];
  }

  override getParameterDefinitions(): BatchJobParameterDefinition[] {
    return [
      {
        key: "maxIterations",
        label: "Max Agent Iterations",
        type: "select",
        options: ["5", "10", "15", "25", "40"],
        defaultValue: "25",
      },
      {
        key: "scanIterations",
        label: "Scan Iterations",
        type: "select",
        options: ["1", "2", "3", "4", "5"],
        defaultValue: "3",
      },
    ];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const logCtx = { scheduleId: ctx.scheduleId, runId: ctx.runId, taskRunId: ctx.taskRunId, handlerName: ctx.handlerName };

    let maxIterations: number | undefined;
    let scanIterations: number | undefined;
    try {
      const parsed = JSON.parse(ctx.configJson || "{}");
      if (typeof parsed.maxIterations === "number" && parsed.maxIterations > 0) {
        maxIterations = parsed.maxIterations;
      }
      if (typeof parsed.scanIterations === "number" && parsed.scanIterations > 0) {
        scanIterations = parsed.scanIterations;
      }
    } catch { /* use default */ }

    const scanResult = await ProactiveBatchJob.runProactiveScan({
      scheduleId: ctx.scheduleId,
      runId: ctx.runId,
      taskRunId: ctx.taskRunId,
      handlerName: ctx.handlerName,
    }, maxIterations, scanIterations);

    if (!scanResult) {
      log("info", "Proactive scan skipped — previous scan still running.", logCtx);
      return { outputJson: { kind: "proactive_scan", skipped: true } };
    }

    log("info", "Proactive scan task completed.", logCtx, {
      primaryThreadId: scanResult.primaryThreadId,
      ...(scanResult.followupThreadId ? { followupThreadId: scanResult.followupThreadId } : {}),
      iterationCount: scanResult.iterationCount,
      toolsUsed: scanResult.toolsUsed,
    });

    return {
      pipelineThreadId: scanResult.primaryThreadId,
      outputJson: {
        kind: "proactive_scan",
        // "threadId" kept for backward-compat with the existing View Output UI
        threadId: scanResult.primaryThreadId,
        primaryThreadId: scanResult.primaryThreadId,
        ...(scanResult.followupThreadId ? { followupThreadId: scanResult.followupThreadId } : {}),
        iterationCount: scanResult.iterationCount,
        iterations: scanResult.iterations,
        toolsUsed: scanResult.toolsUsed,
      },
    };
  }

  protected createDefaultTasks(parameters: Record<string, string> = {}): BatchJobSubTaskTemplate[] {
    const maxIterations = parameters.maxIterations ? Number(parameters.maxIterations) : 25;
    const scanIterations = parameters.scanIterations ? Number(parameters.scanIterations) : 3;
    return [
      {
        task_key: "scan",
        name: "Run proactive scan",
        handler_name: "system.proactive.scan",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
        config_json: { maxIterations, scanIterations },
      },
    ];
  }
}
