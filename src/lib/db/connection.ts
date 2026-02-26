import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "nexus.db");

let _db: Database.Database | null = null;

// ─── Prepared Statement Cache ────────────────────────────────
// Avoids re-compiling SQL on every call (better-sqlite3 .prepare() is synchronous
// but still incurs parsing cost).  Cache is invalidated when the DB is closed.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CachedStatement {
  run(...params: any[]): Database.RunResult;
  get(...params: any[]): any;
  all(...params: any[]): any[];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
/* eslint-enable @typescript-eslint/no-explicit-any */

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    // Performance pragmas
    _db.pragma("synchronous = NORMAL");   // Safe with WAL; avoids fsync per tx
    _db.pragma("cache_size = -64000");     // 64 MB page cache (default is 2 MB)
    _db.pragma("temp_store = MEMORY");     // Keep temp tables/indexes in RAM
    _db.pragma("mmap_size = 268435456");   // 256 MB memory-mapped I/O
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
