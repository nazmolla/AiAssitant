/**
 * Proactive Scan Tool
 *
 * Owns all proactive scan logic:
 * - Prompt building for the proactive LLM agent
 * - Exploration strategy (novelty tracking, follow-up scans)
 * - Scan execution with mutex protection
 *
 * Called by:
 * - Agent loop via ProactiveScanTool.execute()
 * - Unified scheduler engine via ProactiveBatchJob.executeStep() â†’ runProactiveScan()
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/147
 */

import type { ToolDefinition } from "@/lib/llm";
import { BaseTool, type ToolExecutionContext } from "./base-tool";
import { getMcpManager } from "@/lib/mcp";
import { getCustomToolDefinitions } from "@/lib/tools/custom-tools";
import { getToolPolicy } from "@/lib/db/tool-policy-queries";
import { addLog, getAppConfig, setAppConfig } from "@/lib/db/log-queries";
import { createThread } from "@/lib/db/thread-queries";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("tools.proactive-scan-tool");
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

/* â”€â”€ Proactive Scan Prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function buildProactiveScanMessage(
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

/* â”€â”€ Exploration Strategy Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function getToolCategory(toolName: string): "network" | "camera" | "occupancy" | "toolmaker" | "other" {
  if (/net_scan_network|net_scan_ports|net_http_request|nmap|network/i.test(toolName)) return "network";
  if (/camera|wyze|rtsp|onvif|hass.*camera/i.test(toolName)) return "camera";
  if (/motion|occupancy|presence|room|hass.*sensor|wifi/i.test(toolName)) return "occupancy";
  if (/nexus_create_tool|nexus_update_tool|custom\./i.test(toolName)) return "toolmaker";
  return "other";
}

function getLastProactiveTools(): string[] {
  const raw = getAppConfig("proactive_last_tools");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function setLastProactiveTools(tools: string[]): void {
  setAppConfig("proactive_last_tools", JSON.stringify(tools.slice(0, 24)));
}

function buildMustTryTools(availableTools: string[], lastToolsUsed: string[]): string[] {
  const lastSet = new Set(lastToolsUsed);
  const candidates = availableTools.filter((t) => !lastSet.has(t));
  return candidates.slice(0, 6);
}

function hasExplorationCategoryCoverage(toolsUsed: string[]): boolean {
  return toolsUsed.some((tool) => {
    const category = getToolCategory(tool);
    return category === "network" || category === "camera" || category === "occupancy";
  });
}

function hasToolmakerCoverage(toolsUsed: string[]): boolean {
  return toolsUsed.some((tool) => getToolCategory(tool) === "toolmaker");
}

function shouldRunExplorationFollowup(
  toolsUsed: string[],
  lastToolsUsed: string[],
  requireToolmakerAction: boolean
): boolean {
  if (toolsUsed.length === 0) return true;
  const categories = new Set(toolsUsed.map(getToolCategory));
  const onlyOther = categories.size === 1 && categories.has("other");
  const novelty = toolsUsed.some((t) => !lastToolsUsed.includes(t));
  const missingExplorationCoverage = !hasExplorationCategoryCoverage(toolsUsed);
  const missingToolmakerCoverage = requireToolmakerAction && !hasToolmakerCoverage(toolsUsed);
  return onlyOther || !novelty || missingExplorationCoverage || missingToolmakerCoverage;
}

function buildExplorationFollowupMessage(connectedServers: string[], mustTryTools: string[]): string {
  return buildExplorationFollowupMessagePrompt(connectedServers, mustTryTools);
}

/* â”€â”€ Proactive Scan Execution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

let _scanRunning = false;

export interface ProactiveScanResult {
  primaryThreadId: string;
  followupThreadId?: string;
  toolsUsed: string[];
}

export async function runProactiveScan(context?: SchedulerBatchExecutionContext): Promise<ProactiveScanResult | null> {
  if (_scanRunning) {
    addLog({
      level: "info",
      source: "scheduler",
      message: "Skipping proactive scan â€” previous scan still running.",
      metadata: JSON.stringify(mergeBatchContext({}, context)),
    });
    return null;
  }
  _scanRunning = true;

  try {
    return await runProactiveScanInner();
  } finally {
    _scanRunning = false;
  }
}

async function runProactiveScanInner(): Promise<ProactiveScanResult> {
  const t0 = Date.now();
  log.enter("runProactiveScanInner");
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
  const lastToolsUsed = getLastProactiveTools();
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
  const mustTryTools = buildMustTryTools(noApprovalCandidates, lastToolsUsed);

  const scanThread = createThread("[proactive-scan]", defaultAdminUserId, { threadType: "proactive" });
  const scanMessage = buildProactiveScanMessage(connectedServers, mcpTools.length, customToolNames, lastToolsUsed, mustTryTools);

  addLog({
    level: "thought",
    source: "thought",
    message: `[Proactive] Starting scan â€” ${connectedServers.length} MCP server(s) connected, ${mcpTools.length} tools available.`,
    metadata: JSON.stringify({
      connectedServers,
      mcpToolCount: mcpTools.length,
      customToolCount: customToolNames.length,
    }),
  });


  // Use OrchestratorAgent to coordinate specialized agents for the proactive scan.
  const { OrchestratorAgent, AgentRegistry } = await import("@/lib/agent/multi-agent");
  const registry = AgentRegistry.getInstance();
  const orchestrator = new OrchestratorAgent(registry);

  // Errors from the orchestrator are allowed to propagate — the scheduler will mark
  // the task as failed and surface the error to the user rather than silently
  // completing with empty output.
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

  if (shouldRunExplorationFollowup(primaryResult.toolsUsed, lastToolsUsed, requireToolmakerAction)) {
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
        additionalContext: buildExplorationFollowupMessage(connectedServers, mustTryTools),
      },
    );
    finalToolsUsed = followupResult.toolsUsed;

    if (shouldRunExplorationFollowup(finalToolsUsed, lastToolsUsed, requireToolmakerAction)) {
      addLog({
        level: "warn",
        source: "scheduler",
        message: "Proactive follow-up did not fully satisfy exploration constraints.",
        metadata: JSON.stringify({
          toolsUsed: finalToolsUsed,
          requireToolmakerAction,
          hasExplorationCoverage: hasExplorationCategoryCoverage(finalToolsUsed),
          hasToolmakerCoverage: hasToolmakerCoverage(finalToolsUsed),
        }),
      });
    }
  }

  setLastProactiveTools(finalToolsUsed);

  addLog({
    level: "thought",
    source: "thought",
    message: finalToolsUsed.length > 0
      ? `[Proactive] Scan complete — used ${finalToolsUsed.length} tool(s): ${finalToolsUsed.join(", ")}.`
      : "[Proactive] Scan complete â€” no tools were called.",
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

  const scanResult = {
    primaryThreadId: scanThread.id,
    followupThreadId,
    toolsUsed: finalToolsUsed,
  };
  log.exit("runProactiveScanInner", { primaryThreadId: scanThread.id, toolsUsedCount: finalToolsUsed.length }, Date.now() - t0);
  return scanResult;
}

export class ProactiveScanTool extends BaseTool {
  readonly name = "proactive_scan";
  readonly toolNamePrefix = "builtin.workflow_proactive_scan";
  readonly toolsRequiringApproval: string[] = [];
  readonly tools: ToolDefinition[] = [
    {
      name: "builtin.workflow_proactive_scan",
      description: "Run a proactive scan to check for pending tasks, notifications, and system events that need attention.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];

  override matches(toolName: string): boolean {
    return toolName === this.toolNamePrefix;
  }

  async execute(
    _toolName: string,
    _args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<unknown> {
    await runProactiveScan();
    return { status: "completed", kind: "proactive_scan" };
  }
}

export const proactiveScanTool = new ProactiveScanTool();

/* â”€â”€ Tool Class â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */


