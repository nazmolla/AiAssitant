export type UnifiedLogLevel = "verbose" | "thought" | "warning" | "error" | "critical";

export const UNIFIED_LOG_LEVELS: UnifiedLogLevel[] = ["verbose", "thought", "warning", "error", "critical"];

const RANK: Record<UnifiedLogLevel, number> = {
  verbose: 0,
  thought: 1,
  warning: 2,
  error: 3,
  critical: 4,
};

export function normalizeLogLevel(input: string | null | undefined): UnifiedLogLevel {
  const value = (input || "").toLowerCase().trim();

  if (value === "critical" || value === "fatal" || value === "panic") return "critical";
  if (value === "error" || value === "err") return "error";
  if (value === "warning" || value === "warn") return "warning";
  if (value === "thought") return "thought";

  if (
    value === "verbose" ||
    value === "info" ||
    value === "debug" ||
    value === "trace"
  ) {
    return "verbose";
  }

  return "verbose";
}

export function isUnifiedLogLevel(value: string | null | undefined): value is UnifiedLogLevel {
  return !!value && UNIFIED_LOG_LEVELS.includes(value as UnifiedLogLevel);
}

export function shouldKeepLog(level: UnifiedLogLevel, minLevel: UnifiedLogLevel): boolean {
  return RANK[level] >= RANK[minLevel];
}
