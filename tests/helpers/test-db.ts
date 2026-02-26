/**
 * Shared test utilities — sets up an in-memory SQLite database
 * so unit / integration tests never touch the real nexus.db.
 */
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "@/lib/db/schema";

let testDb: Database.Database | null = null;

/**
 * Initialise a fresh in-memory SQLite database with the full schema.
 * Patches `getDb()` / `closeDb()` in the connection module so every
 * query function transparently uses this DB.
 */
export function setupTestDb(): Database.Database {
  testDb = new Database(":memory:");
  testDb.pragma("journal_mode = WAL");
  testDb.pragma("foreign_keys = ON");

  // Execute each statement separately (SCHEMA_SQL is multi-statement)
  const stmts = SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of stmts) {
    testDb.exec(stmt);
  }

  // Create unique index required by upsertKnowledge
  testDb.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_user_entity_attr_val
    ON user_knowledge (user_id, entity, attribute, value);
  `);

  // Monkey-patch the connection module so all queries hit this DB
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const conn = require("@/lib/db/connection");
  // Clear cached prepared statements from any previous DB instance
  conn.clearStmtCache();
  conn.getDb = () => testDb;
  conn.closeDb = () => {
    conn.clearStmtCache();
    if (testDb) {
      testDb.close();
      testDb = null;
    }
  };

  return testDb;
}

/**
 * Tear down the in-memory database.
 */
export function teardownTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}

/**
 * Create a test user (returns the user id).
 */
export function seedTestUser(overrides: {
  email?: string;
  role?: string;
  enabled?: number;
} = {}): string {
  const { v4: uuid } = require("uuid");
  const id = uuid();
  const db = testDb!;
  db.prepare(
    `INSERT INTO users (id, email, display_name, provider_id, role, enabled)
     VALUES (?, ?, ?, 'local', ?, ?)`
  ).run(
    id,
    overrides.email ?? `test-${id.slice(0, 8)}@example.com`,
    "Test User",
    overrides.role ?? "user",
    overrides.enabled ?? 1
  );
  return id;
}
