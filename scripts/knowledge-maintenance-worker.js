'use strict';

const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = workerData && workerData.dbPath ? String(workerData.dbPath) : 'nexus.db';
const DEFAULT_HOUR = 20;
const DEFAULT_MINUTE = 0;
const DEFAULT_POLL_SECONDS = 60;
const DEFAULT_ARCHIVE_DAYS = 180;
const DEFAULT_ARCHIVE_BATCH = 500;

const archiveDbPath = process.env.KNOWLEDGE_ARCHIVE_DB_PATH || path.join(process.cwd(), 'data', 'knowledge-archive.db');

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
  const archiveDays = clampInt(getAppConfig('knowledge_archive_days'), DEFAULT_ARCHIVE_DAYS, 30, 3650);
  return { enabled, hour, minute, pollMs: pollSeconds * 1000, archiveDays };
}

function ensureArchiveDb() {
  const dir = path.dirname(archiveDbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const archiveDb = new Database(archiveDbPath);
  archiveDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS user_knowledge_archive (
      original_id INTEGER UNIQUE,
      user_id TEXT,
      entity TEXT NOT NULL,
      attribute TEXT NOT NULL,
      value TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_context TEXT,
      last_updated DATETIME,
      archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS knowledge_embeddings_archive (
      original_knowledge_id INTEGER PRIMARY KEY,
      embedding_bin BLOB,
      embedding_encoding TEXT DEFAULT 'f32le',
      compression TEXT DEFAULT 'none',
      embedding_json TEXT,
      archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_archive_user_time
      ON user_knowledge_archive(user_id, last_updated DESC);
  `);

  archiveDb.close();
}

function archiveOldKnowledge(archiveDays) {
  ensureArchiveDb();
  db.prepare("ATTACH DATABASE ? AS archive").run(archiveDbPath);
  try {
    const oldRows = db.prepare(
      `SELECT id
       FROM user_knowledge
       WHERE last_updated < datetime('now', '-' || ? || ' days')
       ORDER BY last_updated ASC
       LIMIT ?`
    ).all(archiveDays, DEFAULT_ARCHIVE_BATCH);

    if (!oldRows || oldRows.length === 0) {
      return { archivedKnowledge: 0, archivedEmbeddings: 0 };
    }

    const archivedIds = oldRows.map((row) => Number(row.id));
    const placeholders = archivedIds.map(() => '?').join(',');

    db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO archive.user_knowledge_archive (
           original_id, user_id, entity, attribute, value, source_type, source_context, last_updated, archived_at
         )
         SELECT id, user_id, entity, attribute, value, source_type, source_context, last_updated, CURRENT_TIMESTAMP
         FROM user_knowledge
         WHERE id IN (${placeholders})`
      ).run(...archivedIds);

      db.prepare(
        `INSERT OR IGNORE INTO archive.knowledge_embeddings_archive (
           original_knowledge_id, embedding_bin, embedding_encoding, compression, embedding_json, archived_at
         )
         SELECT knowledge_id, embedding_bin, embedding_encoding, compression, embedding, CURRENT_TIMESTAMP
         FROM knowledge_embeddings
         WHERE knowledge_id IN (${placeholders})`
      ).run(...archivedIds);

      db.prepare(`DELETE FROM user_knowledge WHERE id IN (${placeholders})`).run(...archivedIds);
    })();

    const archivedEmbeddingCount = db.prepare(
      `SELECT COUNT(*) as cnt FROM archive.knowledge_embeddings_archive WHERE original_knowledge_id IN (${placeholders})`
    ).get(...archivedIds);

    return {
      archivedKnowledge: archivedIds.length,
      archivedEmbeddings: Number((archivedEmbeddingCount && archivedEmbeddingCount.cnt) || 0),
    };
  } finally {
    db.exec('DETACH DATABASE archive');
  }
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

    const archived = archiveOldKnowledge(config.archiveDays);

    const now = new Date();
    setAppConfig('knowledge_maintenance_last_run_date', localDateKey(now));
    setAppConfig('knowledge_maintenance_last_run_at', now.toISOString());

    emit('info', 'Knowledge maintenance run completed.', {
      deletedEmpty: Number(deleteEmpty.changes || 0),
      deduplicated: Number(dedupe.changes || 0),
      trimmedSourceContext: Number(trimContext.changes || 0),
      archivedKnowledge: Number(archived.archivedKnowledge || 0),
      archivedEmbeddings: Number(archived.archivedEmbeddings || 0),
      archiveDays: config.archiveDays,
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
