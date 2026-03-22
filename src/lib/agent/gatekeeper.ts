/**
 * Human-in-the-Loop Gatekeeper
 *
 * Reduced to only `executeApprovedTool` — the HITL policy enforcement path
 * is now handled exclusively by `executeToolWithPolicy` in `tool-executor.ts`.
 * Both agent loop variants (main-thread and worker) use that unified path.
 */

import { getToolRegistry } from "./tool-registry";
import {
  updateThreadStatus,
  addLog,
  getThread,
} from "@/lib/db";
import { GATEKEEPER_RESULT_PREVIEW_CHARS } from "@/lib/constants";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("agent.gatekeeper");

export interface GatekeeperResult {
  status: "executed" | "pending_approval" | "error";
  result?: unknown;
  approvalId?: string;
  error?: string;
}

/** Truncate tool results to prevent logging huge payloads */
function truncateResult(result: unknown, maxLen = GATEKEEPER_RESULT_PREVIEW_CHARS): string {
  const str = JSON.stringify(result);
  return str.length > maxLen ? str.slice(0, maxLen) + "...[truncated]" : str;
}

/**
 * Execute a previously approved tool call.
 */
export async function executeApprovedTool(
  toolName: string,
  args: Record<string, unknown>,
  threadId: string
): Promise<GatekeeperResult> {
  const t0 = Date.now();
  log.enter("executeApprovedTool", { toolName, threadId });
  const userId = getThread(threadId)?.user_id ?? undefined;
  try {
    const result = await getToolRegistry().dispatch(
      toolName,
      args,
      { threadId, userId }
    );

    // Resume the thread
    updateThreadStatus(threadId, "active");

    addLog({
      level: "info",
      source: "hitl",
      message: `Approved tool "${toolName}" executed successfully.`,
      metadata: JSON.stringify({ threadId, result: truncateResult(result) }),
    });
    log.info(`Approved tool "${toolName}" executed successfully`, { threadId });
    log.exit("executeApprovedTool", { toolName, status: "executed" }, Date.now() - t0);

    return { status: "executed", result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Still unfreeze the thread — the approval was resolved, don't leave it stuck
    updateThreadStatus(threadId, "active");

    addLog({
      level: "error",
      source: "hitl",
      message: `Approved tool "${toolName}" failed: ${errorMsg}`,
      metadata: JSON.stringify({ threadId }),
    });
    log.error(`Approved tool "${toolName}" failed`, { threadId }, err);

    return { status: "error", error: errorMsg };
  }
}
