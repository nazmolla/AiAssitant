export type UnifiedLogLevel = "verbose" | "warning" | "error" | "critical";

export const UNIFIED_LOG_LEVELS: UnifiedLogLevel[] = ["verbose", "warning", "error", "critical"];

const RANK: Record<UnifiedLogLevel, number> = {
  verbose: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

export function normalizeLogLevel(input: string | null | undefined): UnifiedLogLevel {
  const value = (input || "").toLowerCase().trim();

  if (value === "critical" || value === "fatal" || value === "panic") return "critical";
  if (value === "error" || value === "err") return "error";
  if (value === "warning" || value === "warn") return "warning";

  if (
    value === "verbose" ||
    value === "info" ||
    value === "debug" ||
    value === "trace" ||
    value === "thought"
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
