'use strict';

const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');

const dbPath = workerData && workerData.dbPath ? String(workerData.dbPath) : 'nexus.db';
const DEFAULT_HOUR = 20;
const DEFAULT_MINUTE = 0;
const DEFAULT_POLL_SECONDS = 60;

const db = new Database(dbPath);
let running = false;

function localDateKey(now) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function emit(level, message, metadata) {
  if (parentPort) {
    parentPort.postMessage({ type: 'log', level, message, metadata });
  }
}

function setAppConfig(key, value) {
  db.prepare(
    `INSERT INTO app_config (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(key, value);
}

function getAppConfig(key) {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
  return row && typeof row.value === 'string' ? row.value : undefined;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readRuntimeConfig() {
  const enabledRaw = String(getAppConfig('knowledge_maintenance_enabled') || '1').trim().toLowerCase();
  const enabled = enabledRaw !== '0' && enabledRaw !== 'false' && enabledRaw !== 'no';
  const hour = clampInt(getAppConfig('knowledge_maintenance_hour'), DEFAULT_HOUR, 0, 23);
  const minute = clampInt(getAppConfig('knowledge_maintenance_minute'), DEFAULT_MINUTE, 0, 59);
  const pollSeconds = clampInt(getAppConfig('knowledge_maintenance_poll_seconds'), DEFAULT_POLL_SECONDS, 30, 300);
  return { enabled, hour, minute, pollMs: pollSeconds * 1000 };
}

function runMaintenance(config) {
  if (running) {
    emit('verbose', 'Knowledge maintenance skipped because previous run is still active.', { reason: 'overlap' });
    return;
  }

  running = true;
  const startedAt = Date.now();

  try {
    emit('info', 'Knowledge maintenance run started.', {
      dbPath,
      hour: config.hour,
      minute: config.minute,
    });

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
    setAppConfig('knowledge_maintenance_last_run_date', localDateKey(now));
    setAppConfig('knowledge_maintenance_last_run_at', now.toISOString());

    emit('info', 'Knowledge maintenance run completed.', {
      deletedEmpty: Number(deleteEmpty.changes || 0),
      deduplicated: Number(dedupe.changes || 0),
      trimmedSourceContext: Number(trimContext.changes || 0),
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    emit('error', 'Knowledge maintenance run failed.', {
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
  } finally {
    running = false;
  }
}

function tick() {
  try {
    const config = readRuntimeConfig();
    if (!config.enabled) return;

    const lastRunDate = getAppConfig('knowledge_maintenance_last_run_date');
    const now = new Date();
    const windowReached = now.getHours() > config.hour || (now.getHours() === config.hour && now.getMinutes() >= config.minute);
    if (lastRunDate !== localDateKey(now) && windowReached) {
      runMaintenance(config);
    }
  } catch (err) {
    emit('error', 'Knowledge maintenance scheduler tick failed.', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function scheduleNextTick() {
  const config = readRuntimeConfig();
  const delay = config.pollMs;
  const timer = setTimeout(() => {
    tick();
    scheduleNextTick();
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
}

process.on('uncaughtException', (err) => {
  emit('error', 'Knowledge maintenance worker uncaught exception.', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  emit('error', 'Knowledge maintenance worker unhandled rejection.', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

const startupConfig = readRuntimeConfig();
emit('info', 'Knowledge maintenance worker online.', {
  dbPath,
  enabled: startupConfig.enabled,
  hour: startupConfig.hour,
  minute: startupConfig.minute,
  pollMs: startupConfig.pollMs,
});
tick();
scheduleNextTick();
