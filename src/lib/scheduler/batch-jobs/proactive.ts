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
  type BatchJobSubTaskTemplate,
  type StepExecutionContext,
  type StepExecutionResult,
  type LogFn,
} from "./base";

// ── Proactive Scan Types & State ──────────────────────────────────

export interface ProactiveScanResult {
  primaryThreadId: string;
  followupThreadId?: string;
  toolsUsed: string[];
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

  // ── Main Execution ────────────────────────────────────

  private static async runProactiveScan(context?: SchedulerBatchExecutionContext): Promise<ProactiveScanResult | null> {
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
      return await this.runProactiveScanInner();
    } finally {
      this._scanRunning = false;
    }
  }

  private static async runProactiveScanInner(): Promise<ProactiveScanResult> {
    const defaultAdminUserId = getDefaultAdminUserId() ?? "";

    addLog({
      level: "info",
      source: "scheduler",
      message: "Proactive scan started.",
      metadata: JSON.stringify({ adminUserId: defaultAdminUserId }),
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

    const scanThread = createThread("[proactive-scan]", defaultAdminUserId, { threadType: "proactive" });
    const scanMessage = this.buildProactiveScanMessage(connectedServers, mcpTools.length, customToolNames, lastToolsUsed, mustTryTools);

    addLog({
      level: "thought",
      source: "thought",
      message: `[Proactive] Starting scan — ${connectedServers.length} MCP server(s) connected, ${mcpTools.length} tools available.`,
      metadata: JSON.stringify({
        connectedServers,
        mcpToolCount: mcpTools.length,
        customToolCount: customToolNames.length,
      }),
    });

    const { OrchestratorAgent, AgentRegistry } = await import("@/lib/agent/multi-agent");
    const registry = AgentRegistry.getInstance();
    const orchestrator = new OrchestratorAgent(registry);

    const primaryResult = await orchestrator.run(
      PROACTIVE_PRIMARY_TASK_PROMPT,
      {
        userId: defaultAdminUserId,
        threadId: scanThread.id,
        additionalContext: scanMessage,
      },
    );

    let followupThreadId: string | undefined;
    let finalToolsUsed = primaryResult.toolsUsed;

    if (this.shouldRunExplorationFollowup(primaryResult.toolsUsed, lastToolsUsed, requireToolmakerAction)) {
      addLog({
        level: "info",
        source: "scheduler",
        message: "Proactive follow-up scan triggered due to low novelty/exploration depth.",
        metadata: JSON.stringify({ firstTools: primaryResult.toolsUsed, lastToolsUsed }),
      });

      const followupThread = createThread("[proactive-scan-followup]", defaultAdminUserId, { threadType: "proactive" });
      followupThreadId = followupThread.id;
      const followupOrchestrator = new OrchestratorAgent(registry);
      const followupResult = await followupOrchestrator.run(
        PROACTIVE_FOLLOWUP_TASK_PROMPT,
        {
          userId: defaultAdminUserId,
          threadId: followupThread.id,
          additionalContext: this.buildExplorationFollowupMessage(connectedServers, mustTryTools),
        },
      );
      finalToolsUsed = followupResult.toolsUsed;

      if (this.shouldRunExplorationFollowup(finalToolsUsed, lastToolsUsed, requireToolmakerAction)) {
        addLog({
          level: "warn",
          source: "scheduler",
          message: "Proactive follow-up did not fully satisfy exploration constraints.",
          metadata: JSON.stringify({
            toolsUsed: finalToolsUsed,
            requireToolmakerAction,
            hasExplorationCoverage: this.hasExplorationCategoryCoverage(finalToolsUsed),
            hasToolmakerCoverage: this.hasToolmakerCoverage(finalToolsUsed),
          }),
        });
      }
    }

    this.setLastProactiveTools(finalToolsUsed);

    addLog({
      level: "thought",
      source: "thought",
      message: finalToolsUsed.length > 0
        ? `[Proactive] Scan complete — used ${finalToolsUsed.length} tool(s): ${finalToolsUsed.join(", ")}.`
        : "[Proactive] Scan complete — no tools were called.",
      metadata: JSON.stringify({
        threadId: scanThread.id,
        toolsUsed: finalToolsUsed,
      }),
    });

    if (primaryResult.response) {
      addLog({
        level: "thought",
        source: "thought",
        message: `[Proactive] Agent response:\n${primaryResult.response.slice(0, 2000)}`,
        metadata: JSON.stringify({ threadId: scanThread.id, full: primaryResult.response.length <= 2000 }),
      });
    }

    addLog({
      level: "info",
      source: "scheduler",
      message: "Proactive scan completed.",
      metadata: JSON.stringify({
        primaryThreadId: scanThread.id,
        followupThreadId,
        toolsUsed: finalToolsUsed,
        responsePreview: primaryResult.response.slice(0, 500),
      }),
    });

    return {
      primaryThreadId: scanThread.id,
      followupThreadId,
      toolsUsed: finalToolsUsed,
    };
  }

  canExecuteHandler(handlerName: string): boolean {
    return handlerName === "system.proactive.scan";
  }

  getHandlerNames(): string[] {
    return ["system.proactive.scan"];
  }

  async executeStep(ctx: StepExecutionContext, log: LogFn): Promise<StepExecutionResult> {
    const logCtx = { scheduleId: ctx.scheduleId, runId: ctx.runId, taskRunId: ctx.taskRunId, handlerName: ctx.handlerName };
    const scanResult = await ProactiveBatchJob.runProactiveScan({
      scheduleId: ctx.scheduleId,
      runId: ctx.runId,
      taskRunId: ctx.taskRunId,
      handlerName: ctx.handlerName,
    });

    if (!scanResult) {
      log("info", "Proactive scan skipped — previous scan still running.", logCtx);
      return { outputJson: { kind: "proactive_scan", skipped: true } };
    }

    log("info", "Proactive scan task completed.", logCtx, {
      primaryThreadId: scanResult.primaryThreadId,
      ...(scanResult.followupThreadId ? { followupThreadId: scanResult.followupThreadId } : {}),
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
        toolsUsed: scanResult.toolsUsed,
      },
    };
  }

  protected createDefaultTasks(): BatchJobSubTaskTemplate[] {
    return [
      {
        task_key: "scan",
        name: "Run proactive scan",
        handler_name: "system.proactive.scan",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
      },
    ];
  }
}
