import { getDb } from "./connection";
import { stmt } from "./query-helpers";
import fs from "fs";
import os from "os";
import path from "path";
import { getAppConfig, setAppConfig, deleteLogsOlderThanDays } from "./log-queries";
import { deleteThread } from "./thread-queries";
import { env } from "@/lib/env";

const ATTACHMENTS_ROOT = path.join(process.cwd(), "data", "attachments");

function getDbFilePath(): string {
  return env.DATABASE_PATH;
}

export interface DbMaintenanceConfig {
  enabled: boolean;
  intervalHours: number;
  logsRetentionDays: number;
  threadsRetentionDays: number;
  attachmentsRetentionDays: number;
  cleanupLogs: boolean;
  cleanupThreads: boolean;
  cleanupAttachments: boolean;
  cleanupOrphanFiles: boolean;
  lastRunAt: string | null;
}

export interface DbTableBreakdown {
  table: string;
  rowCount: number;
  estimatedBytes: number | null;
}

export interface DbStorageStats {
  dbPath: string;
  dbBytes: number;
  walBytes: number;
  shmBytes: number;
  attachmentsBytes: number;
  totalManagedBytes: number;
  pageCount: number;
  pageSize: number;
  tables: DbTableBreakdown[];
}

export interface HostResourceUsage {
  platform: NodeJS.Platform;
  uptimeSec: number;
  cpuCount: number;
  loadAvg: number[];
  process: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  system: {
    totalMemBytes: number;
    freeMemBytes: number;
  };
}

export interface DbMaintenanceRunResult {
  mode: "manual" | "scheduled";
  startedAt: string;
  completedAt: string;
  deletedLogs: number;
  deletedThreads: number;
  deletedMessages: number;
  deletedAttachmentRows: number;
  deletedFiles: number;
  deletedOrphanFiles: number;
}

function readBoolConfig(key: string, fallback: boolean): boolean {
  const raw = (getAppConfig(key) ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return fallback;
}

function readIntConfig(key: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(getAppConfig(key) ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function fileSizeIfExists(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function getDirectorySizeBytes(dirPath: string): number {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirectorySizeBytes(fullPath);
      } else if (entry.isFile()) {
        total += fileSizeIfExists(fullPath);
      }
    }
    return total;
  } catch {
    return 0;
  }
}

function listFilesRecursive(dirPath: string, out: string[]): void {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      listFilesRecursive(fullPath, out);
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
}

function pruneEmptyDirectories(root: string): void {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subPath = path.join(root, entry.name);
    pruneEmptyDirectories(subPath);
    try {
      const remaining = fs.readdirSync(subPath);
      if (remaining.length === 0) {
        fs.rmdirSync(subPath);
      }
    } catch {
      // Ignore concurrent filesystem changes.
    }
  }
}

function normalizeStoragePath(storagePath: string): string {
  return storagePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function deleteStorageFile(storagePath: string): boolean {
  const rel = normalizeStoragePath(storagePath);
  const abs = path.join(ATTACHMENTS_ROOT, rel);
  try {
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function getDbMaintenanceConfig(): DbMaintenanceConfig {
  return {
    enabled: readBoolConfig("db_maintenance_enabled", false),
    intervalHours: readIntConfig("db_maintenance_interval_hours", 24, 1, 24 * 30),
    logsRetentionDays: readIntConfig("db_maintenance_logs_retention_days", 30, 1, 3650),
    threadsRetentionDays: readIntConfig("db_maintenance_threads_retention_days", 90, 1, 3650),
    attachmentsRetentionDays: readIntConfig("db_maintenance_attachments_retention_days", 90, 1, 3650),
    cleanupLogs: readBoolConfig("db_maintenance_cleanup_logs", true),
    cleanupThreads: readBoolConfig("db_maintenance_cleanup_threads", false),
    cleanupAttachments: readBoolConfig("db_maintenance_cleanup_attachments", false),
    cleanupOrphanFiles: readBoolConfig("db_maintenance_cleanup_orphan_files", true),
    lastRunAt: getAppConfig("db_maintenance_last_run_at") ?? null,
  };
}

export function setDbMaintenanceConfig(partial: Partial<DbMaintenanceConfig>): DbMaintenanceConfig {
  const current = getDbMaintenanceConfig();
  const next: DbMaintenanceConfig = {
    ...current,
    ...partial,
    intervalHours: Math.min(24 * 30, Math.max(1, Math.floor(partial.intervalHours ?? current.intervalHours))),
    logsRetentionDays: Math.min(3650, Math.max(1, Math.floor(partial.logsRetentionDays ?? current.logsRetentionDays))),
    threadsRetentionDays: Math.min(3650, Math.max(1, Math.floor(partial.threadsRetentionDays ?? current.threadsRetentionDays))),
    attachmentsRetentionDays: Math.min(3650, Math.max(1, Math.floor(partial.attachmentsRetentionDays ?? current.attachmentsRetentionDays))),
  };

  setAppConfig("db_maintenance_enabled", next.enabled ? "1" : "0");
  setAppConfig("db_maintenance_interval_hours", String(next.intervalHours));
  setAppConfig("db_maintenance_logs_retention_days", String(next.logsRetentionDays));
  setAppConfig("db_maintenance_threads_retention_days", String(next.threadsRetentionDays));
  setAppConfig("db_maintenance_attachments_retention_days", String(next.attachmentsRetentionDays));
  setAppConfig("db_maintenance_cleanup_logs", next.cleanupLogs ? "1" : "0");
  setAppConfig("db_maintenance_cleanup_threads", next.cleanupThreads ? "1" : "0");
  setAppConfig("db_maintenance_cleanup_attachments", next.cleanupAttachments ? "1" : "0");
  setAppConfig("db_maintenance_cleanup_orphan_files", next.cleanupOrphanFiles ? "1" : "0");
  if (next.lastRunAt) {
    setAppConfig("db_maintenance_last_run_at", next.lastRunAt);
  }

  return getDbMaintenanceConfig();
}

export function getDbStorageStats(): DbStorageStats {
  const db = getDb();
  const dbPath = getDbFilePath();
  const dbBytes = fileSizeIfExists(dbPath);
  const walBytes = fileSizeIfExists(`${dbPath}-wal`);
  const shmBytes = fileSizeIfExists(`${dbPath}-shm`);
  const attachmentsBytes = getDirectorySizeBytes(ATTACHMENTS_ROOT);
  const pageSize = Number(db.pragma("page_size", { simple: true }) || 0);
  const pageCount = Number(db.pragma("page_count", { simple: true }) || 0);

  const tableNames = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;

  let dbstatAvailable = true;
  const tables: DbTableBreakdown[] = tableNames.map(({ name }) => {
    const escaped = name.replace(/"/g, '""');
    const row = db.prepare(`SELECT COUNT(*) as count FROM "${escaped}"`).get() as { count: number };

    let estimatedBytes: number | null = null;
    if (dbstatAvailable) {
      try {
        const sizeRow = db.prepare("SELECT SUM(pgsize) as bytes FROM dbstat WHERE name = ?").get(name) as { bytes: number | null } | undefined;
        estimatedBytes = Number(sizeRow?.bytes || 0);
      } catch {
        dbstatAvailable = false;
        estimatedBytes = null;
      }
    }

    return {
      table: name,
      rowCount: Number(row.count || 0),
      estimatedBytes,
    };
  });

  return {
    dbPath,
    dbBytes,
    walBytes,
    shmBytes,
    attachmentsBytes,
    totalManagedBytes: dbBytes + walBytes + shmBytes + attachmentsBytes,
    pageCount,
    pageSize,
    tables,
  };
}

export function getHostResourceUsage(): HostResourceUsage {
  const mem = process.memoryUsage();
  return {
    platform: os.platform(),
    uptimeSec: Math.floor(os.uptime()),
    cpuCount: os.cpus().length,
    loadAvg: os.loadavg(),
    process: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
    },
    system: {
      totalMemBytes: os.totalmem(),
      freeMemBytes: os.freemem(),
    },
  };
}

export function runDbMaintenance(mode: "manual" | "scheduled" = "manual", override?: Partial<DbMaintenanceConfig>): DbMaintenanceRunResult {
  const startedAt = new Date().toISOString();
  const config = { ...getDbMaintenanceConfig(), ...(override || {}) };
  const db = getDb();

  let deletedLogs = 0;
  let deletedThreads = 0;
  let deletedMessages = 0;
  let deletedAttachmentRows = 0;
  let deletedFiles = 0;
  let deletedOrphanFiles = 0;

  if (config.cleanupLogs) {
    deletedLogs += deleteLogsOlderThanDays(config.logsRetentionDays);
  }

  if (config.cleanupThreads) {
    const cutoff = `-${Math.max(1, Math.floor(config.threadsRetentionDays))} days`;
    const oldThreads = db
      .prepare("SELECT id FROM threads WHERE last_message_at < datetime('now', ?)")
      .all(cutoff) as Array<{ id: string }>;

    for (const t of oldThreads) {
      const msgCount = db.prepare("SELECT COUNT(*) as count FROM messages WHERE thread_id = ?").get(t.id) as { count: number };
      const attRows = db.prepare("SELECT storage_path FROM attachments WHERE thread_id = ?").all(t.id) as Array<{ storage_path: string }>;

      deletedMessages += Number(msgCount.count || 0);
      deletedAttachmentRows += attRows.length;

      for (const att of attRows) {
        if (deleteStorageFile(att.storage_path)) {
          deletedFiles += 1;
        }
      }

      deleteThread(t.id);
      deletedThreads += 1;
    }
  }

  if (config.cleanupAttachments) {
    const cutoff = `-${Math.max(1, Math.floor(config.attachmentsRetentionDays))} days`;
    const oldAttachments = db
      .prepare("SELECT id, storage_path FROM attachments WHERE created_at < datetime('now', ?)")
      .all(cutoff) as Array<{ id: string; storage_path: string }>;

    for (const att of oldAttachments) {
      if (deleteStorageFile(att.storage_path)) {
        deletedFiles += 1;
      }
      db.prepare("DELETE FROM attachments WHERE id = ?").run(att.id);
      deletedAttachmentRows += 1;
    }
  }

  if (config.cleanupOrphanFiles) {
    const files: string[] = [];
    listFilesRecursive(ATTACHMENTS_ROOT, files);
    const known = new Set(
      (db.prepare("SELECT storage_path FROM attachments").all() as Array<{ storage_path: string }>).map((r) => normalizeStoragePath(r.storage_path))
    );

    for (const filePath of files) {
      const rel = normalizeStoragePath(path.relative(ATTACHMENTS_ROOT, filePath));
      if (!known.has(rel)) {
        try {
          fs.unlinkSync(filePath);
          deletedOrphanFiles += 1;
        } catch {
          // Ignore races and permission edge cases.
        }
      }
    }

    pruneEmptyDirectories(ATTACHMENTS_ROOT);
  }

  const completedAt = new Date().toISOString();
  setAppConfig("db_maintenance_last_run_at", completedAt);

  return {
    mode,
    startedAt,
    completedAt,
    deletedLogs,
    deletedThreads,
    deletedMessages,
    deletedAttachmentRows,
    deletedFiles,
    deletedOrphanFiles,
  };
}

export function runDbMaintenanceIfDue(now = new Date()): DbMaintenanceRunResult | null {
  const cfg = getDbMaintenanceConfig();
  if (!cfg.enabled) return null;

  const lastRunMs = cfg.lastRunAt ? Date.parse(cfg.lastRunAt) : 0;
  const intervalMs = Math.max(1, cfg.intervalHours) * 60 * 60 * 1000;
  if (lastRunMs > 0 && now.getTime() - lastRunMs < intervalMs) {
    return null;
  }

  return runDbMaintenance("scheduled", cfg);
}
