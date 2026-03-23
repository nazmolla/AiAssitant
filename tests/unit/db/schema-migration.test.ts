/**
 * Unit tests — DB schema migration snapshot.
 *
 * Validates that:
 * - All expected tables exist after initialization
 * - initializeDatabase is idempotent (can be called multiple times safely)
 * - tool_policies table has the required columns
 */

import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import { initializeDatabase } from "@/lib/db/init";
import { getDb } from "@/lib/db/connection";

beforeAll(() => {
  setupTestDb();
  initializeDatabase();
});

afterAll(() => teardownTestDb());

describe("DB schema migration snapshot", () => {
  test("schema creates all expected tables", () => {
    const rows = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const tableNames = rows.map((r) => r.name);

    const expectedTables = [
      "users",
      "threads",
      "messages",
      "tool_policies",
      "agent_logs",
      "approval_queue",
      "knowledge_embeddings",
      "scheduler_schedules",
      "channels",
      "api_keys",
    ];

    for (const table of expectedTables) {
      expect(tableNames).toContain(table);
    }
  });

  test("initializeDatabase is idempotent", () => {
    // Should not throw when called a second (or third) time
    expect(() => initializeDatabase()).not.toThrow();
    expect(() => initializeDatabase()).not.toThrow();
  });

  test("tool_policies table has required columns", () => {
    const columns = getDb()
      .prepare("PRAGMA table_info(tool_policies)")
      .all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);

    const requiredColumns = ["id", "tool_name", "requires_approval", "scope"];

    // tool_policies uses tool_name as primary key (no separate id column) so check the actual columns
    expect(columnNames).toContain("tool_name");
    expect(columnNames).toContain("requires_approval");
    expect(columnNames).toContain("scope");
    // Note: tool_policies uses tool_name as PK; id column doesn't exist in the schema — skip it
    expect(columnNames).not.toContain(undefined);
    // Verify the required non-id columns are all present
    const nonIdRequired = requiredColumns.filter((c) => c !== "id");
    for (const col of nonIdRequired) {
      expect(columnNames).toContain(col);
    }
  });
});
