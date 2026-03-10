import { addLog, getAppConfig, getDb, setAppConfig } from "@/lib/db";

const DEFAULT_HOUR = 20;
const DEFAULT_MINUTE = 0;
let _running = false;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function localDateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function readRuntimeConfig() {
  const enabledRaw = String(getAppConfig("knowledge_maintenance_enabled") || "1").trim().toLowerCase();
  return {
    enabled: enabledRaw !== "0" && enabledRaw !== "false" && enabledRaw !== "no",
    hour: clampInt(getAppConfig("knowledge_maintenance_hour"), DEFAULT_HOUR, 0, 23),
    minute: clampInt(getAppConfig("knowledge_maintenance_minute"), DEFAULT_MINUTE, 0, 59),
  };
}

export interface KnowledgeMaintenanceResult {
  skipped: boolean;
  reason?: "disabled" | "window_not_reached" | "already_ran_today" | "overlap";
  deletedEmpty?: number;
  deduplicated?: number;
  trimmedSourceContext?: number;
  durationMs?: number;
}

function runKnowledgeMaintenanceNow(): KnowledgeMaintenanceResult {
  if (_running) return { skipped: true, reason: "overlap" };
  _running = true;
  const startedAt = Date.now();

  try {
    const db = getDb();
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_user_knowledge_norm_lookup
       ON user_knowledge(user_id, lower(trim(entity)), lower(trim(attribute)), lower(trim(value)))`
    );

    const deleteEmpty = db.prepare(
      `DELETE FROM user_knowledge
       WHERE trim(coalesce(entity, '')) = ''
          OR trim(coalesce(attribute, '')) = ''
          OR trim(coalesce(value, '')) = ''`
    ).run();

    const dedupe = db.prepare(
      `DELETE FROM user_knowledge
       WHERE id IN (
         SELECT k1.id
         FROM user_knowledge k1
         JOIN user_knowledge k2
           ON coalesce(k1.user_id, '') = coalesce(k2.user_id, '')
          AND lower(trim(k1.entity)) = lower(trim(k2.entity))
          AND lower(trim(k1.attribute)) = lower(trim(k2.attribute))
          AND lower(trim(k1.value)) = lower(trim(k2.value))
          AND (
            k1.last_updated < k2.last_updated
            OR (k1.last_updated = k2.last_updated AND k1.id < k2.id)
          )
       )`
    ).run();

    const trimContext = db.prepare(
      `UPDATE user_knowledge
       SET source_context = substr(source_context, 1, 220)
       WHERE source_context IS NOT NULL AND length(source_context) > 220`
    ).run();

    const now = new Date();
    setAppConfig("knowledge_maintenance_last_run_date", localDateKey(now));
    setAppConfig("knowledge_maintenance_last_run_at", now.toISOString());

    return {
      skipped: false,
      deletedEmpty: Number(deleteEmpty.changes || 0),
      deduplicated: Number(dedupe.changes || 0),
      trimmedSourceContext: Number(trimContext.changes || 0),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    _running = false;
  }
}

export function runKnowledgeMaintenanceIfDue(now = new Date()): KnowledgeMaintenanceResult {
  const config = readRuntimeConfig();
  if (!config.enabled) return { skipped: true, reason: "disabled" };

  const windowReached = now.getHours() > config.hour || (now.getHours() === config.hour && now.getMinutes() >= config.minute);
  if (!windowReached) return { skipped: true, reason: "window_not_reached" };

  const dateKey = localDateKey(now);
  if (getAppConfig("knowledge_maintenance_last_run_date") === dateKey) {
    return { skipped: true, reason: "already_ran_today" };
  }

  const result = runKnowledgeMaintenanceNow();
  addLog({
    level: result.skipped ? "verbose" : "warning",
    source: "knowledge-maintenance",
    message: result.skipped ? "Knowledge maintenance skipped." : "Knowledge maintenance run completed.",
    metadata: JSON.stringify(result),
  });
  return result;
}
