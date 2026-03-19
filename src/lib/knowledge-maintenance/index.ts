import { addLog, getAppConfig, getDb, setAppConfig } from "@/lib/db";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("knowledge.maintenance");

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
  const fuzzyEnabledRaw = String(getAppConfig("knowledge_maintenance_fuzzy_enabled") || "1").trim().toLowerCase();
  const fuzzyThresholdRaw = getAppConfig("knowledge_maintenance_fuzzy_threshold");
  return {
    enabled: enabledRaw !== "0" && enabledRaw !== "false" && enabledRaw !== "no",
    hour: clampInt(getAppConfig("knowledge_maintenance_hour"), DEFAULT_HOUR, 0, 23),
    minute: clampInt(getAppConfig("knowledge_maintenance_minute"), DEFAULT_MINUTE, 0, 59),
    fuzzyEnabled: fuzzyEnabledRaw !== "0" && fuzzyEnabledRaw !== "false" && fuzzyEnabledRaw !== "no",
    fuzzyThreshold: Math.max(0, Math.min(1, parseFloat(String(fuzzyThresholdRaw ?? "0.85")) || 0.85)),
  };
}

export interface KnowledgeMaintenanceResult {
  skipped: boolean;
  reason?: "disabled" | "window_not_reached" | "already_ran_today" | "overlap";
  deletedEmpty?: number;
  deduplicated?: number;
  fuzzyDeduplicated?: number;
  trimmedSourceContext?: number;
  durationMs?: number;
}

// ── Fuzzy deduplication helpers ─────────────────────────────────────

/**
 * Sørensen–Dice bigram similarity coefficient.
 * Returns a value in [0, 1] where 1 means identical strings.
 */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigrams.get(bg) ?? 0;
    if (count > 0) {
      intersection++;
      bigrams.set(bg, count - 1);
    }
  }

  return (2 * intersection) / (a.length + b.length - 2);
}

interface RawKnowledgeRow {
  id: number;
  user_id: string | null;
  entity: string;
  attribute: string;
  value: string;
  last_updated: string;
}

/**
 * Fuzzy deduplication pass — runs after exact dedup.
 * Groups entries by (user_id, entity, attribute) then compares values pairwise.
 * Deletes the older entry whenever similarity >= threshold.
 * Returns the count of entries deleted.
 */
function runFuzzyDedup(threshold: number): number {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT id, user_id, entity, attribute, value, last_updated
       FROM user_knowledge
       ORDER BY coalesce(user_id, ''), lower(trim(entity)), lower(trim(attribute)),
                last_updated DESC, id DESC`
    )
    .all() as RawKnowledgeRow[];

  // Group by (user_id, normalised entity, normalised attribute)
  const groups = new Map<string, RawKnowledgeRow[]>();
  for (const row of rows) {
    const key = `${row.user_id ?? ""}\0${row.entity.toLowerCase().trim()}\0${row.attribute.toLowerCase().trim()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const toDelete = new Set<number>();

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Rows are ordered newest-first; keep the first non-deleted entry in each pair
    for (let i = 0; i < group.length - 1; i++) {
      if (toDelete.has(group[i].id)) continue;
      const normI = group[i].value.toLowerCase().trim();
      for (let j = i + 1; j < group.length; j++) {
        if (toDelete.has(group[j].id)) continue;
        const normJ = group[j].value.toLowerCase().trim();
        if (diceSimilarity(normI, normJ) >= threshold) {
          toDelete.add(group[j].id); // keep group[i] (newer), delete group[j]
        }
      }
    }
  }

  if (toDelete.size === 0) return 0;

  // Use batched deletes to avoid "too many SQL variables" for large sets
  const ids = [...toDelete];
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    db.prepare(`DELETE FROM user_knowledge WHERE id IN (${batch.map(() => "?").join(",")})`).run(batch);
  }

  return toDelete.size;
}

// ── Main maintenance function ────────────────────────────────────────

function runKnowledgeMaintenanceNow(): KnowledgeMaintenanceResult {
  if (_running) return { skipped: true, reason: "overlap" };
  _running = true;
  const startedAt = Date.now();

  try {
    const { fuzzyEnabled, fuzzyThreshold } = readRuntimeConfig();
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

    const fuzzyDeduplicated = fuzzyEnabled ? runFuzzyDedup(fuzzyThreshold) : 0;

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
      fuzzyDeduplicated,
      trimmedSourceContext: Number(trimContext.changes || 0),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    _running = false;
  }
}

export function runKnowledgeMaintenanceIfDue(now = new Date()): KnowledgeMaintenanceResult {
  const t0 = Date.now();
  log.enter("runKnowledgeMaintenanceIfDue");
  const config = readRuntimeConfig();
  if (!config.enabled) {
    log.exit("runKnowledgeMaintenanceIfDue", { skipped: true, reason: "disabled" }, Date.now() - t0);
    return { skipped: true, reason: "disabled" };
  }

  const windowReached = now.getHours() > config.hour || (now.getHours() === config.hour && now.getMinutes() >= config.minute);
  if (!windowReached) {
    log.exit("runKnowledgeMaintenanceIfDue", { skipped: true, reason: "window_not_reached" }, Date.now() - t0);
    return { skipped: true, reason: "window_not_reached" };
  }

  const dateKey = localDateKey(now);
  if (getAppConfig("knowledge_maintenance_last_run_date") === dateKey) {
    log.exit("runKnowledgeMaintenanceIfDue", { skipped: true, reason: "already_ran_today" }, Date.now() - t0);
    return { skipped: true, reason: "already_ran_today" };
  }

  const result = runKnowledgeMaintenanceNow();
  addLog({
    level: result.skipped ? "verbose" : "warning",
    source: "knowledge-maintenance",
    message: result.skipped ? "Knowledge maintenance skipped." : "Knowledge maintenance run completed.",
    metadata: JSON.stringify(result),
  });
  if (!result.skipped) {
    log.warning("Knowledge maintenance run completed", { deletedEmpty: result.deletedEmpty, deduplicated: result.deduplicated, durationMs: result.durationMs });
  }
  log.exit("runKnowledgeMaintenanceIfDue", { skipped: result.skipped }, Date.now() - t0);
  return result;
}
