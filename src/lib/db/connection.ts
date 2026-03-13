import Database from "better-sqlite3";
import { env } from "@/lib/env";
import { DB_BUSY_TIMEOUT_MS, DB_CACHE_SIZE_KB, DB_MMAP_SIZE } from "@/lib/constants";

const DB_PATH = env.DATABASE_PATH;

let _db: Database.Database | null = null;

// ─── Prepared Statement Cache ────────────────────────────────
// Avoids re-compiling SQL on every call (better-sqlite3 .prepare() is synchronous
// but still incurs parsing cost).  Cache is invalidated when the DB is closed.

export interface CachedStatement {
  run(...params: any[]): Database.RunResult;
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

const _stmtCache = new Map<string, CachedStatement>();

/** Clear all cached prepared statements (used by test helpers after DB swaps) */
export function clearStmtCache(): void {
  _stmtCache.clear();
}

/**
 * Get a cached prepared statement. Compiles on first use, reuses thereafter.
 * `dbGetter` must be provided by the caller (uses the imported getDb from the
 * calling module so test monkey-patching works correctly).
 */
export function cachedStmt(sql: string, dbGetter: () => Database.Database): CachedStatement {
  let stmt = _stmtCache.get(sql);
  if (!stmt) {
    stmt = dbGetter().prepare(sql) as unknown as CachedStatement;
    _stmtCache.set(sql, stmt);
  }
  return stmt;
}

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    _db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
    // Performance pragmas
    _db.pragma("synchronous = NORMAL");   // Safe with WAL; avoids fsync per tx
    _db.pragma(`cache_size = ${DB_CACHE_SIZE_KB}`);
    _db.pragma("temp_store = MEMORY");     // Keep temp tables/indexes in RAM
    _db.pragma(`mmap_size = ${DB_MMAP_SIZE}`);
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _stmtCache.clear();
    _db.close();
    _db = null;
  }
}
