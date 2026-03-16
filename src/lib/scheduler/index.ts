/**
 * Scheduler — Tool Execution & Proactive Approval
 *
 * This module handles:
 * - Tool execution during proactive scans (quiet-hours enforcement, routing)
 * - Post-approval tool execution for proactive-approved actions
 *
 * Architecture (post-refactor):
 * - shared.ts               → constants, types, helpers (quiet hours, batch context)
 * - batch-jobs/proactive.ts  → proactive scan logic, prompt building, novelty tracking
 * - batch-jobs/email.ts      → IMAP polling, email batch processing, digest delivery
 * - index.ts (this file)     → tool execution, proactive approval dispatch
 */

import { getMcpManager } from "@/lib/mcp";
import {
  isBuiltinWebTool,
  executeBuiltinWebTool,
  isBrowserTool,
  executeBrowserTool,
  isFsTool,
  executeBuiltinFsTool,
  isNetworkTool,
  executeBuiltinNetworkTool,
  isEmailTool,
  executeBuiltinEmailTool,
  isPhoneTool,
  executeBuiltinPhoneTool,
  isFileTool,
  executeBuiltinFileTool,
  isCustomTool,
  executeCustomTool,
  isAlexaTool,
  executeAlexaTool,
} from "@/lib/agent";
import { normalizeToolName } from "@/lib/agent/discovery";
import { addLog } from "@/lib/db";
import {
  isQuietHours,
  isNoisyTool,
  QUIET_HOURS_START,
  QUIET_HOURS_END,
} from "./shared";

// ── Re-exports for backward compatibility ────────────────────────
export {
  type SchedulerBatchExecutionContext,
  isQuietHours,
  isNoisyTool,
  QUIET_HOURS_START,
  QUIET_HOURS_END,
  mergeBatchContext,
  addContextLog,
  getDefaultAdminUserId,
} from "./shared";

/* ── Tool Execution ───────────────────────────────────────────────── */

const _proactiveSkipWarned = new Set<string>();

function getToolServerId(qualifiedToolName: string): string | null {
  const dotIndex = qualifiedToolName.indexOf(".");
  if (dotIndex === -1) return null;
  return qualifiedToolName.substring(0, dotIndex);
}

type SchedulerToolExecution =
  | { skipped: true }
  | { skipped: false; result: unknown };

async function executeSchedulerTool(
  toolName: string,
  args: Record<string, unknown>,
  mcpManager: ReturnType<typeof getMcpManager>
): Promise<SchedulerToolExecution> {
  toolName = normalizeToolName(toolName);

  if (isQuietHours() && isNoisyTool(toolName, args)) {
    addLog({
      level: "info",
      source: "scheduler",
      message: `Blocked "${toolName}" during quiet hours (${QUIET_HOURS_START}:00–${QUIET_HOURS_END}:00).`,
      metadata: JSON.stringify({ toolName, args }),
    });
    return { skipped: true };
  }

  if (isBuiltinWebTool(toolName)) {
    return { skipped: false, result: await executeBuiltinWebTool(toolName, args) };
  }
  if (isBrowserTool(toolName)) {
    return { skipped: false, result: await executeBrowserTool(toolName, args) };
  }
  if (isFsTool(toolName)) {
    return { skipped: false, result: await executeBuiltinFsTool(toolName, args) };
  }
  if (isFileTool(toolName)) {
    return { skipped: false, result: await executeBuiltinFileTool(toolName, args) };
  }
  if (isNetworkTool(toolName)) {
    return { skipped: false, result: await executeBuiltinNetworkTool(toolName, args) };
  }
  if (isEmailTool(toolName)) {
    return { skipped: false, result: await executeBuiltinEmailTool(toolName, args) };
  }
  if (isPhoneTool(toolName)) {
    return { skipped: false, result: await executeBuiltinPhoneTool(toolName, args) };
  }
  if (isAlexaTool(toolName)) {
    return { skipped: false, result: await executeAlexaTool(toolName, args) };
  }
  if (isCustomTool(toolName)) {
    return { skipped: false, result: await executeCustomTool(toolName, args) };
  }

  const serverId = getToolServerId(toolName);
  if (!serverId || !mcpManager.isConnected(serverId)) {
    if (!_proactiveSkipWarned.has(toolName)) {
      addLog({
        level: "warn",
        source: "scheduler",
        message: `Skipping proactive tool \"${toolName}\": MCP server \"${serverId || "unknown"}\" is not connected.`,
        metadata: JSON.stringify({ toolName, serverId: serverId || "unknown" }),
      });
      _proactiveSkipWarned.add(toolName);
    }
    return { skipped: true };
  }

  _proactiveSkipWarned.delete(toolName);
  const mcpPromise = mcpManager.callTool(toolName, args);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`MCP tool "${toolName}" timed out after 60s`)), 60_000)
  );
  return { skipped: false, result: await Promise.race([mcpPromise, timeoutPromise]) };
}

/**
 * Execute a tool that was approved through the proactive approval flow.
 * This is the public API used by the approvals POST handler when a proactive
 * (thread_id === null) approval is approved by the user.
 */
export async function executeProactiveApprovedTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const mcpManager = getMcpManager();
  const execution = await executeSchedulerTool(toolName, args, mcpManager);
  if (execution.skipped) {
    throw new Error(`Tool "${toolName}" skipped: MCP server not connected.`);
  }
  return execution.result;
}
