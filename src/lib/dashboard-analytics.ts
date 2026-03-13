/**
 * Pure helper functions and types for the agent dashboard.
 * Extracted from agent-dashboard.tsx (SRP — issue #113).
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface LogEntry {
  id: number;
  level: "verbose" | "warning" | "error" | "critical";
  source: string | null;
  message: string;
  metadata: string | null;
  created_at: string;
}

export type LogFilter = "all" | "verbose" | "warning" | "error" | "critical" | "thought";
export type ChartMetric = "activities" | "errors";
export type DashboardView = "graphs" | "details";

export interface TimeBucket {
  start: number;
  end: number;
  label: string;
  activities: number;
  errors: number;
  sessions: number;
}

export interface SessionRecord {
  id: string;
  logs: LogEntry[];
  outcome: "resolved" | "escalated" | "abandoned" | "open";
  engaged: boolean;
  topic: string;
  lastTs: number;
}

export interface DriverRow {
  topic: string;
  rate: number;
  impact: number;
}

// ── Pure helpers ───────────────────────────────────────────────────────

export function levelColor(level: string): "error" | "warning" | "default" | "info" | "primary" {
  switch (level) {
    case "critical": return "error";
    case "error": return "error";
    case "warning": return "warning";
    case "verbose": return "default";
    default: return "info";
  }
}

export function sourceColor(source: string | null) {
  switch (source) {
    case "agent": return "text-blue-400";
    case "scheduler": return "text-purple-400";
    case "mcp": return "text-green-400";
    case "hitl": return "text-yellow-400";
    default: return "text-muted-foreground";
  }
}

export function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return { value: parsed };
  } catch {
    return { raw };
  }
}

export function formatMetaValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value, null, 2);
}

export function extractSessionKey(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const candidateKeys = ["sessionId", "session_id", "threadId", "thread_id", "conversationId", "conversation_id", "chatId", "chat_id", "run_id"];
    for (const key of candidateKeys) {
      const val = obj[key];
      if (typeof val === "string" && val.trim()) return val;
      if (typeof val === "number") return String(val);
    }
    return null;
  } catch {
    return null;
  }
}

export function inferOutcome(logs: LogEntry[]): "resolved" | "escalated" | "abandoned" | "open" {
  const text = logs.map((log) => `${log.message} ${log.metadata ?? ""}`.toLowerCase()).join(" ");
  if (/abandon|cancel|timeout|dropped|terminated/.test(text)) return "abandoned";
  if (/escalat|failed|fatal|critical|denied|exception/.test(text)) return "escalated";
  if (/resolved|completed|success|approved|done/.test(text)) return "resolved";
  return "open";
}

export function inferTopic(logs: LogEntry[]): string {
  const text = logs.map((log) => `${log.message} ${log.metadata ?? ""}`.toLowerCase()).join(" ");
  if (/payment|billing|invoice|refund/.test(text)) return "Payment";
  if (/device|alexa|smarthome|light|volume/.test(text)) return "Device";
  if (/network|connection|socket|dns|latency/.test(text)) return "Connectivity";
  if (/auth|token|login|credential|permission/.test(text)) return "Authentication";
  if (/mcp|tool|plugin/.test(text)) return "Tooling";
  return "General";
}

export function toPct(value: number): string {
  return `${Math.round(value)}%`;
}
