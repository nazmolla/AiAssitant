import { getDb, cachedStmt as _cachedStmt } from "./connection";
import { normalizeLogLevel, shouldKeepLog, type UnifiedLogLevel, isUnifiedLogLevel } from "@/lib/logging/levels";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import type { ILogger } from "@/lib/container";
import { container } from "@/lib/container";
import { createNotification, type NotificationType } from "./notification-queries";
import { listUsersWithPermissions } from "./user-queries";

/** Thin wrapper that passes the (patchable) `getDb` import to the cache */
function stmt(sql: string) { return _cachedStmt(sql, getDb); }

// ——— Agent Logs ——————————————————————————————————————

export interface AgentLog {
  id: number;
  level: UnifiedLogLevel;
  source: string | null;
  message: string;
  metadata: string | null;
  created_at: string;
}

export interface AgentLogInput {
  level: string;
  source: string | null;
  message: string;
  metadata: string | null;
  /** Optional user to receive the in-app notification. Falls back to admin. */
  userId?: string;
}

/** Raw log levels that warrant an in-app notification (excludes noisy internal levels). */
const NOTIFICATION_RAW_LEVELS = new Set(["info", "warning", "warn", "error", "err", "critical", "fatal", "panic"]);

function rawLevelToNotificationType(rawLevel: string): NotificationType {
  if (rawLevel === "warning" || rawLevel === "warn") return "warning";
  if (rawLevel === "error" || rawLevel === "err") return "system_error";
  if (rawLevel === "critical" || rawLevel === "fatal" || rawLevel === "panic") return "system_error";
  return "info";
}

let _cachedAdminId: string | undefined;
function getAdminUserId(): string {
  if (_cachedAdminId) return _cachedAdminId;
  try {
    const admin = listUsersWithPermissions().find((u) => u.role === "admin" && u.enabled === 1);
    if (admin) { _cachedAdminId = admin.id; return admin.id; }
  } catch { /* DB not ready yet */ }
  return "";
}

export function getAppConfig(key: string): string | undefined {
  const row = stmt("SELECT value FROM app_config WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value;
}

export function setAppConfig(key: string, value: string): void {
  stmt(
    `INSERT INTO app_config (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(key, value);
}

export function getServerMinLogLevel(): UnifiedLogLevel {
  const value = getAppConfig("log_level_min");
  if (isUnifiedLogLevel(value)) return value;
  return "verbose";
}

export function setServerMinLogLevel(level: UnifiedLogLevel): void {
  setAppConfig("log_level_min", level);
}

function getConfiguredMinLogLevel(): UnifiedLogLevel {
  return getServerMinLogLevel();
}

export function addLog(log: AgentLogInput): void {
  const rawLevel = String(log.level || "").toLowerCase().trim();
  const normalizedLevel = normalizeLogLevel(log.level);
  const minLevel = getConfiguredMinLogLevel();
  // Thought-level logs always bypass the server min-log-level filter.
  // They are important diagnostic observations (not verbose noise) and must
  // always be persisted so the dashboard Thoughts view is never silently empty.
  if (rawLevel !== "thought" && !shouldKeepLog(normalizedLevel, minLevel)) {
    return;
  }

  const normalizedSource =
    rawLevel === "thought" && !log.source
      ? "thought"
      : log.source;

  stmt(
    `INSERT INTO agent_logs (level, source, message, metadata) VALUES (?, ?, ?, ?)`
  ).run(normalizedLevel, normalizedSource, log.message, log.metadata);

  // Hardwire notification-worthy log levels to the in-app notification bell.
  // Excludes noisy internal levels (verbose, debug, trace, thought).
  if (NOTIFICATION_RAW_LEVELS.has(rawLevel)) {
    try {
      const notifUserId = log.userId || getAdminUserId();
      if (notifUserId) {
        const title = log.message.length > 100 ? log.message.slice(0, 97) + "…" : log.message;
        const body = log.message.length > 100 ? log.message : null;
        createNotification({
          userId: notifUserId,
          type: rawLevelToNotificationType(rawLevel),
          title,
          body,
          metadata: log.metadata,
        });
      }
    } catch { /* never let notification failure break logging */ }
  }
}

export function getRecentLogs(limit = 100, level?: UnifiedLogLevel | "all", source?: string | "all", metadataContains?: string[]): AgentLog[] {
  const filterByLevel = !!level && level !== "all";
  const filterBySource = !!source && source !== "all";
  const metadataTokens = (metadataContains || []).filter((token) => typeof token === "string" && token.trim().length > 0);
  const filterByMetadata = metadataTokens.length > 0;
  // PERF-17: Clamp to sensible bounds to prevent unbounded queries
  const safeLimit = (!Number.isFinite(limit) || limit <= 0) ? 1000 : Math.min(limit, 10000);
  if (filterByMetadata) {
    const clauses: string[] = [];
    const args: Array<string | number> = [];

    if (filterByLevel) {
      clauses.push("level = ?");
      args.push(level!);
    }
    if (filterBySource) {
      clauses.push("source = ?");
      args.push(source!);
    }
    for (const token of metadataTokens) {
      clauses.push("metadata LIKE ?");
      args.push(`%${token}%`);
    }

    args.push(safeLimit);
    return stmt(
      `SELECT * FROM agent_logs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`
    ).all(...args) as AgentLog[];
  }

  if (filterByLevel && filterBySource) {
    return stmt(
      "SELECT * FROM agent_logs WHERE level = ? AND source = ? ORDER BY created_at DESC LIMIT ?"
    ).all(level, source, safeLimit) as AgentLog[];
  }
  if (filterByLevel) {
    return stmt(
      "SELECT * FROM agent_logs WHERE level = ? ORDER BY created_at DESC LIMIT ?"
    ).all(level, safeLimit) as AgentLog[];
  }
  if (filterBySource) {
    return stmt(
      "SELECT * FROM agent_logs WHERE source = ? ORDER BY created_at DESC LIMIT ?"
    ).all(source, safeLimit) as AgentLog[];
  }
  return stmt("SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ?").all(safeLimit) as AgentLog[];
}

export function getLogsAfterId(
  afterId: number,
  limit = 200,
  level?: UnifiedLogLevel | "all",
  source?: string | "all"
): AgentLog[] {
  const filterByLevel = !!level && level !== "all";
  const filterBySource = !!source && source !== "all";
  const safeAfterId = Number.isFinite(afterId) ? Math.max(0, Math.floor(afterId)) : 0;
  const safeLimit = (!Number.isFinite(limit) || limit <= 0) ? 200 : Math.min(limit, 1000);

  if (filterByLevel && filterBySource) {
    return stmt(
      "SELECT * FROM agent_logs WHERE id > ? AND level = ? AND source = ? ORDER BY id ASC LIMIT ?"
    ).all(safeAfterId, level, source, safeLimit) as AgentLog[];
  }
  if (filterByLevel) {
    return stmt(
      "SELECT * FROM agent_logs WHERE id > ? AND level = ? ORDER BY id ASC LIMIT ?"
    ).all(safeAfterId, level, safeLimit) as AgentLog[];
  }
  if (filterBySource) {
    return stmt(
      "SELECT * FROM agent_logs WHERE id > ? AND source = ? ORDER BY id ASC LIMIT ?"
    ).all(safeAfterId, source, safeLimit) as AgentLog[];
  }
  return stmt("SELECT * FROM agent_logs WHERE id > ? ORDER BY id ASC LIMIT ?").all(safeAfterId, safeLimit) as AgentLog[];
}

export function deleteAllLogs(): number {
  const result = stmt("DELETE FROM agent_logs").run();
  return Number(result.changes || 0);
}

export function deleteLogsByLevel(level: UnifiedLogLevel): number {
  const result = stmt("DELETE FROM agent_logs WHERE level = ?").run(level);
  return Number(result.changes || 0);
}

export function deleteLogsOlderThanDays(days: number): number {
  const safeDays = Math.max(1, Math.floor(days));
  const result = stmt("DELETE FROM agent_logs WHERE created_at < datetime('now', ?) ").run(`-${safeDays} days`);
  return Number(result.changes || 0);
}

// ── ILogger adapter ──────────────────────────────────────────

class DbLogger implements ILogger {
  log(level: UnifiedLogLevel, source: string | null, message: string, metadata?: string | null): void {
    addLog({ level, source, message, metadata: metadata ?? null });
  }
  verbose(source: string | null, message: string, metadata?: string | null): void {
    this.log("verbose", source, message, metadata);
  }
  warning(source: string | null, message: string, metadata?: string | null): void {
    this.log("warning", source, message, metadata);
  }
  error(source: string | null, message: string, metadata?: string | null): void {
    this.log("error", source, message, metadata);
  }
}

container.registerDefault("logger", () => new DbLogger());
