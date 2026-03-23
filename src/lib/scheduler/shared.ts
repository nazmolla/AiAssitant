/**
 * scheduler/shared.ts — Shared scheduler infrastructure.
 *
 * Constants, types, and helpers used across scheduler modules.
 * Extracted to avoid circular dependencies between index and batch jobs.
 */

import { addLog } from "@/lib/db/log-queries";
import { listUsersWithPermissions } from "@/lib/db/user-queries";

/* ── Quiet Hours (no audio-producing tools) ────────────────────── */

export const QUIET_HOURS_START = 22; // 10 PM
export const QUIET_HOURS_END = 8;   // 8 AM

const NOISY_TOOL_PATTERNS = /\b(announce|play_media|play_music|play_sound|play_audio|speak|tts|text_to_speech|media_play)\b/i;

export function isQuietHours(): boolean {
  const hour = new Date().getHours();
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

export function isNoisyTool(toolName: string, _args?: Record<string, unknown>): boolean {
  return NOISY_TOOL_PATTERNS.test(toolName);
}

/* ── Batch Execution Context ──────────────────────────────────────── */

export interface SchedulerBatchExecutionContext {
  scheduleId?: string;
  runId?: string;
  taskRunId?: string;
  handlerName?: string;
}

export function mergeBatchContext(
  metadata: Record<string, unknown> | undefined,
  context?: SchedulerBatchExecutionContext,
): Record<string, unknown> {
  return {
    ...(metadata || {}),
    ...(context ? {
      scheduleId: context.scheduleId || null,
      runId: context.runId || null,
      taskRunId: context.taskRunId || null,
      handlerName: context.handlerName || null,
    } : {}),
  };
}

export function addContextLog(
  level: "verbose" | "info" | "warning" | "error" | "thought" | "warn",
  source: string,
  message: string,
  metadata?: Record<string, unknown>,
  context?: SchedulerBatchExecutionContext,
): void {
  addLog({
    level,
    source,
    message,
    metadata: JSON.stringify(mergeBatchContext(metadata, context)),
  });
}

/* ── User helpers ─────────────────────────────────────────────────── */

export function getDefaultAdminUserId(): string | undefined {
  const admin = listUsersWithPermissions().find((u) => u.role === "admin" && u.enabled === 1);
  return admin?.id;
}
