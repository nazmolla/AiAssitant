/**
 * Unit tests — Search indexes & optimized searchKnowledge (PERF-11)
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  searchKnowledge,
  upsertKnowledge,
  listKnowledge,
} from "@/lib/db/queries";
import { getDb } from "@/lib/db";

let userId: string;
let otherUserId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "search-idx@test.com" });
  otherUserId = seedTestUser({ email: "search-idx-other@test.com" });
});
afterAll(() => teardownTestDb());

describe("index creation", () => {
  test("idx_user_knowledge_user_id exists", () => {
    const idx = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_user_knowledge_user_id'")
      .get() as { name: string } | undefined;
    expect(idx).toBeDefined();
    expect(idx!.name).toBe("idx_user_knowledge_user_id");
  });

  test("idx_user_knowledge_entity exists", () => {
    const idx = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_user_knowledge_entity'")
      .get() as { name: string } | undefined;
    expect(idx).toBeDefined();
    expect(idx!.name).toBe("idx_user_knowledge_entity");
  });

  test("idx_user_knowledge_attribute exists", () => {
    const idx = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_user_knowledge_attribute'")
      .get() as { name: string } | undefined;
    expect(idx).toBeDefined();
    expect(idx!.name).toBe("idx_user_knowledge_attribute");
  });
});

describe("searchKnowledge correctness", () => {
  beforeAll(() => {
    upsertKnowledge({ entity: "ProjectAlpha", attribute: "status", value: "active", source_context: null, user_id: userId });
    upsertKnowledge({ entity: "ProjectBeta", attribute: "deadline", value: "2025-12-01", source_context: null, user_id: userId });
    upsertKnowledge({ entity: "ServerConfig", attribute: "region", value: "us-east-1", source_context: null, user_id: userId });
    upsertKnowledge({ entity: "UserPreference", attribute: "theme", value: "dark-alpha", source_context: null, user_id: userId });
    // Entry for a different user — should not appear in user-scoped searches
    upsertKnowledge({ entity: "ProjectAlpha", attribute: "status", value: "active", source_context: null, user_id: otherUserId });
  });

  test("matches entity field", () => {
    const results = searchKnowledge("ProjectAlpha", userId);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.entity === "ProjectAlpha")).toBe(true);
  });

  test("matches attribute field", () => {
    const results = searchKnowledge("deadline", userId);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.attribute === "deadline")).toBe(true);
  });

  test("matches value field", () => {
    const results = searchKnowledge("us-east-1", userId);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.value === "us-east-1")).toBe(true);
  });

  test("partial match works (substring)", () => {
    const results = searchKnowledge("Alpha", userId);
    // Should match "ProjectAlpha" entity and "dark-alpha" value
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test("returns empty array for no-match query", () => {
    const results = searchKnowledge("zzz_nonexistent_zzz", userId);
    expect(results).toEqual([]);
  });

  test("returns empty for undefined/null userId", () => {
    expect(searchKnowledge("ProjectAlpha")).toEqual([]);
    expect(searchKnowledge("ProjectAlpha", undefined)).toEqual([]);
  });

  test("does not return other user's entries", () => {
    const results = searchKnowledge("ProjectAlpha", userId);
    expect(results.every(r => r.user_id === userId || r.user_id === null)).toBe(true);
  });

  test("results are ordered by last_updated DESC", () => {
    const results = searchKnowledge("Project", userId);
    for (let i = 1; i < results.length; i++) {
      expect(new Date(results[i - 1].last_updated).getTime())
        .toBeGreaterThanOrEqual(new Date(results[i].last_updated).getTime());
    }
  });
});

describe("search performance benchmarks", () => {
  let benchUser: string;

  beforeAll(() => {
    benchUser = seedTestUser({ email: "bench-search@test.com" });
  });

  function seedEntries(count: number): void {
    const db = getDb();
    const insert = db.prepare(
      "INSERT OR IGNORE INTO user_knowledge (user_id, entity, attribute, value) VALUES (?, ?, ?, ?)"
    );
    const tx = db.transaction(() => {
      for (let i = 0; i < count; i++) {
        insert.run(benchUser, `entity_${i}`, `attr_${i % 50}`, `value_${i}_data`);
      }
    });
    tx();
  }

  function benchSearch(query: string): number {
    const start = performance.now();
    searchKnowledge(query, benchUser);
    return performance.now() - start;
  }

  test("100 entries: search completes under 50ms", () => {
    seedEntries(100);
    const elapsed = benchSearch("entity_5");
    expect(elapsed).toBeLessThan(50);
  });

  test("1000 entries: search completes under 100ms", () => {
    seedEntries(1000);
    const elapsed = benchSearch("entity_50");
    expect(elapsed).toBeLessThan(100);
  });

  test("5000 entries: search completes under 500ms", () => {
    seedEntries(5000);
    const elapsed = benchSearch("entity_250");
    expect(elapsed).toBeLessThan(500);
  });

  test("EXPLAIN QUERY PLAN uses index for user_id filtering", () => {
    const plan = getDb()
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT * FROM user_knowledge
         WHERE user_id = ? AND (entity LIKE ? OR attribute LIKE ? OR value LIKE ?)`
      )
      .all("test", "%q%", "%q%", "%q%") as Array<{ detail: string }>;
    const details = plan.map(r => r.detail).join(" ");
    // SQLite should reference an index on user_id for filtering
    expect(details).toMatch(/USING INDEX|SEARCH/i);
  });
});
