/**
 * Inline approval types and helpers for the Nexus agent loop.
 * Extracted from loop.ts for maintainability.
 */

import type { Message } from "@/lib/db";

export const INLINE_APPROVAL_MARKER = "<!-- INLINE_APPROVAL:";

export interface InlineApprovalPayload {
  tool_name: string;
  args: Record<string, unknown>;
  reason: string;
  requester: string;
  source: string;
  tool_call_id: string;
}

export function isAffirmativeApproval(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(yes|y|approve|approved|allow|confirm|go ahead|do it|proceed)\b/.test(normalized);
}

export function isNegativeApproval(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(no|n|reject|rejected|deny|denied|cancel|stop|ignore)\b/.test(normalized);
}

export function extractLatestInlineApproval(messages: Message[]): InlineApprovalPayload | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "system" || !message.content) continue;
    const markerIndex = message.content.indexOf(INLINE_APPROVAL_MARKER);
    if (markerIndex < 0) continue;
    const raw = message.content.slice(markerIndex + INLINE_APPROVAL_MARKER.length);
    const end = raw.indexOf("-->");
    if (end < 0) continue;
    try {
      const parsed = JSON.parse(raw.slice(0, end)) as InlineApprovalPayload;
      if (
        parsed &&
        typeof parsed.tool_name === "string" &&
        parsed.args &&
        typeof parsed.reason === "string" &&
        typeof parsed.requester === "string" &&
        typeof parsed.source === "string"
      ) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function extractApprovalReason(reasoning: string | undefined, args: Record<string, unknown>): string | null {
  const fromReasoning = (reasoning || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => !!line && !line.startsWith("{"));

  if (fromReasoning) return fromReasoning.slice(0, 500);

  for (const key of ["reason", "rationale", "justification", "purpose", "why", "note", "message"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 500);
    }
  }

  return null;
}
