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
 * - Unified scheduler engine via ProactiveBatchJob.executeStep() → runProactiveScan()
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/147
 */

import type { ToolDefinition } from "@/lib/llm";
import { BaseTool, type ToolExecutionContext } from "./base-tool";
import { getMcpManager } from "@/lib/mcp";
import { runAgentLoop } from "@/lib/agent";
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
  isQuietHours,
  QUIET_HOURS_START,
  QUIET_HOURS_END,
  getDefaultAdminUserId,
  mergeBatchContext,
} from "@/lib/scheduler/shared";

/* ── Proactive Scan Prompt ────────────────────────────────────────── */

function buildProactiveScanMessage(
  connectedServers: string[],
  mcpToolCount: number,
  customToolNames: string[],
  lastToolsUsed: string[],
  mustTryTools: string[]
): string {
  const now = new Date();
  const quiet = isQuietHours();
  const quietNote = quiet
    ? `\n\n**QUIET HOURS ACTIVE (${QUIET_HOURS_START}:00–${QUIET_HOURS_END}:00)** — Do NOT use any audio-producing tools (announcements, TTS, playing media, increasing volume). Read-only queries and muting/lowering volume are fine.`
    : "";

  const serverSection = connectedServers.length > 0
    ? `\n\n## Connected MCP servers (USE THESE — they are your primary data sources)\n${connectedServers.map((s) => `- **${s}** (call tools prefixed with \`${s}.\`)`).join("\n")}\nTotal MCP tools available: ${mcpToolCount}`
    : "\n\n## No MCP servers connected\nYou have no external service integrations right now. Focus on built-in tools (web search, network scan, file system, email).";

  const customSection = customToolNames.length > 0
    ? `\n\n## Custom tools you created previously\n${customToolNames.map((n) => `- ${n}`).join("\n")}\nConsider using these if relevant.`
    : "";

  const noveltySection = lastToolsUsed.length > 0
    ? `\n\n## Novelty requirement\nLast scan used: ${lastToolsUsed.slice(0, 8).join(", ")}.\nThis scan MUST include at least one different discovery/action path. Do not only repeat last scan's exact tools unless no alternatives exist.`
    : "";

  const mustTrySection = mustTryTools.length > 0
    ? `\n\n## Mandatory exploration candidates (policy-safe first)\nChoose at least ONE of these tools in this scan: ${mustTryTools.join(", ")}.\nIf one fails, immediately try the next candidate.`
    : "";

  return `[Proactive Scan — ${now.toISOString()}]

You are running as the Nexus proactive observer. This is an autonomous background scan — no human is in this conversation. Your job is to actively discover, monitor, and improve the owner's smart home and environment.${serverSection}${customSection}${noveltySection}${mustTrySection}

## Your approach — Multi-round discovery
You MUST call tools to do real work. A scan that does not call any tools is a FAILED scan. Follow these steps:

1. **Discover**: Call tools to list devices, get states, check sensors, query services. Start with broad discovery tools (e.g. list all devices, get entity states, check what's available in each connected service).
2. **Gather**: Based on discovery results, call more specific tools to get detailed status, readings, or metrics that look interesting or need attention.
3. **Analyze**: Compare what you found against the owner's known preferences, time of day, patterns, and common sense.
4. **Act**: If something needs action — do it (or create an approval request for destructive actions). Examples: adjust thermostat, turn off forgotten lights, announce a reminder, send a notification.
5. **Learn**: If you discover a recurring pattern that could benefit from a custom tool, create one using nexus_create_tool. If an existing custom tool has issues, update it with nexus_update_tool.

## What to look for
- Smart home device states (lights left on, thermostat settings, door/window sensors, media players)
- Environmental data (temperature, humidity, weather, air quality)
- Service health (MCP server connectivity, device online/offline status)
- Opportunities for automation (time-based routines, energy savings, comfort optimization)
- Anomalies or unexpected states (devices in wrong state for time of day, unusual readings)
- Media server status, recently added content, playback state
- Network device status
- Camera fleet discovery and capability mapping (RTSP/ONVIF/API surfaces where available)
- Occupancy inference opportunities using available infrastructure (motion, wifi presence, media activity, room signals)

## Rules
- **You MUST call at least one tool** — start by calling a listing/discovery tool from the connected MCP servers above
- **You MUST perform at least one exploratory step that was NOT in the previous scan** unless every alternative tool fails
- **NEVER ask questions.** No human is reading this. Do not end your thoughts with questions like "Should I…?", "Would the owner prefer…?", or "Is this worth investigating?". Instead, decide and act. You are the proactive agent — make the call yourself based on context, owner preferences, time of day, and common sense.
- If a tool fails or a service is disconnected, note it and move on — don't treat transient failures as disasters
- Smart home / IoT events are NEVER "disaster" severity
- Do NOT send notifications about tool failures or service hiccups
- Combine data from multiple sources for cross-service intelligence (e.g. weather + thermostat + time of day)
- After gathering data, ALWAYS provide a summary of what you found and any actions taken — state facts and decisions, never questions${quietNote}

## Policy behavior
- Respect tool policy settings strictly. If a tool is configured with approval OFF, execute it directly.
- Prefer no-approval tools for broad exploration first, then escalate to approval-required tools only when necessary for meaningful progress.

Begin your proactive scan now. Start by calling discovery tools on each connected MCP server.`;
}

/* ── Exploration Strategy Helpers ─────────────────────────────────── */

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
  const serverList = connectedServers.length > 0 ? connectedServers.join(", ") : "none";
  return `[Proactive Exploration Follow-up]
Previous proactive pass was too repetitive or shallow.

You must run a focused exploration pass now.
- Connected servers: ${serverList}
- Mandatory: execute at least one network/camera/occupancy discovery action.
- Mandatory: if available, attempt one toolmaker action (nexus_create_tool or nexus_update_tool) that improves camera/occupancy intelligence.
- Candidate tools: ${mustTryTools.length > 0 ? mustTryTools.join(", ") : "Use any available discovery/toolmaker tools"}

Do not repeat the previous summary pattern. Produce concrete discoveries, actions taken, and next automation opportunities.`;
}

/* ── Proactive Scan Execution ─────────────────────────────────────── */

let _scanRunning = false;

export async function runProactiveScan(context?: SchedulerBatchExecutionContext): Promise<void> {
  if (_scanRunning) {
    addLog({
      level: "info",
      source: "scheduler",
      message: "Skipping proactive scan — previous scan still running.",
      metadata: JSON.stringify(mergeBatchContext({}, context)),
    });
    return;
  }
  _scanRunning = true;

  try {
    await runProactiveScanInner();
  } finally {
    _scanRunning = false;
  }
}

async function runProactiveScanInner(): Promise<void> {
  const defaultAdminUserId = getDefaultAdminUserId();

  addLog({
    level: "info",
    source: "scheduler",
    message: "Proactive scan started.",
    metadata: JSON.stringify({ adminUserId: defaultAdminUserId }),
  });

  const mcpManager = getMcpManager();

  try {
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
      message: `[Proactive] Starting scan — ${connectedServers.length} MCP server(s) connected, ${mcpTools.length} tools available.`,
      metadata: JSON.stringify({
        connectedServers,
        mcpToolCount: mcpTools.length,
        customToolCount: customToolNames.length,
      }),
    });

    const onStatus = (status: { step: string; detail?: string }) => {
      addLog({
        level: "thought",
        source: "thought",
        message: `[Proactive] ${status.step}${status.detail ? ` — ${status.detail}` : ""}`,
        metadata: JSON.stringify({ threadId: scanThread.id, step: status.step, detail: status.detail }),
      });
    };

    const result = await runAgentLoop(
      scanThread.id,
      scanMessage,
      undefined,
      undefined,
      undefined,
      defaultAdminUserId,
      undefined,
      onStatus,
    );

    let finalResult = result;
    if (shouldRunExplorationFollowup(result.toolsUsed, lastToolsUsed, requireToolmakerAction)) {
      addLog({
        level: "info",
        source: "scheduler",
        message: "Proactive follow-up scan triggered due to low novelty/exploration depth.",
        metadata: JSON.stringify({ firstTools: result.toolsUsed, lastToolsUsed }),
      });

      const followupThread = createThread("[proactive-scan-followup]", defaultAdminUserId, { threadType: "proactive" });
      finalResult = await runAgentLoop(
        followupThread.id,
        buildExplorationFollowupMessage(connectedServers, mustTryTools),
        undefined,
        undefined,
        undefined,
        defaultAdminUserId,
        undefined,
        onStatus,
      );

      if (shouldRunExplorationFollowup(finalResult.toolsUsed, lastToolsUsed, requireToolmakerAction)) {
        addLog({
          level: "warn",
          source: "scheduler",
          message: "Proactive follow-up did not fully satisfy exploration constraints.",
          metadata: JSON.stringify({
            toolsUsed: finalResult.toolsUsed,
            requireToolmakerAction,
            hasExplorationCoverage: hasExplorationCategoryCoverage(finalResult.toolsUsed),
            hasToolmakerCoverage: hasToolmakerCoverage(finalResult.toolsUsed),
          }),
        });
      }
    }

    setLastProactiveTools(finalResult.toolsUsed);

    addLog({
      level: "thought",
      source: "thought",
      message: finalResult.toolsUsed.length > 0
        ? `[Proactive] Scan complete — used ${finalResult.toolsUsed.length} tool(s): ${finalResult.toolsUsed.join(", ")}.`
        : "[Proactive] Scan complete — no tools were called.",
      metadata: JSON.stringify({
        threadId: scanThread.id,
        toolsUsed: finalResult.toolsUsed,
        pendingApprovals: finalResult.pendingApprovals,
      }),
    });

    if (finalResult.content) {
      addLog({
        level: "thought",
        source: "thought",
        message: `[Proactive] Agent response:\n${finalResult.content.slice(0, 2000)}`,
        metadata: JSON.stringify({ threadId: scanThread.id, full: finalResult.content.length <= 2000 }),
      });
    }

    addLog({
      level: "info",
      source: "scheduler",
      message: "Proactive agent scan completed.",
      metadata: JSON.stringify({
        threadId: scanThread.id,
        toolsUsed: finalResult.toolsUsed,
        pendingApprovals: finalResult.pendingApprovals,
        responsePreview: (finalResult.content || "").slice(0, 500),
      }),
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    addLog({
      level: "error",
      source: "scheduler",
      message: `Proactive agent scan LLM invocation failed: ${errorMsg}`,
      metadata: JSON.stringify({
        error: errorMsg,
        phase: "agent_loop_invocation",
        scanStartTime: new Date().toISOString(),
      }),
    });
  }

  addLog({
    level: "info",
    source: "scheduler",
    message: "Proactive scan completed.",
    metadata: JSON.stringify({}),
  });
}

/* ── Tool Class ───────────────────────────────────────────────────── */

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
