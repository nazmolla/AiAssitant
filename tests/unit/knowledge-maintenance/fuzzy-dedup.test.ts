/**
 * Unit tests — fuzzy deduplication for knowledge maintenance (#182)
 *
 * Tests the diceSimilarity utility and the fuzzy dedup pass behaviour
 * exercised via runKnowledgeMaintenanceIfDue with an in-memory SQLite DB.
 */

import { diceSimilarity } from "@/lib/knowledge-maintenance";

// ── diceSimilarity unit tests ────────────────────────────────────────

describe("diceSimilarity", () => {
  test("identical strings return 1.0", () => {
    expect(diceSimilarity("hello world", "hello world")).toBe(1);
  });

  test("completely different strings return 0", () => {
    // No shared bigrams between "ab" and "cd"
    expect(diceSimilarity("ab", "cd")).toBe(0);
  });

  test("strings shorter than 2 chars return 0 (not identical)", () => {
    expect(diceSimilarity("a", "b")).toBe(0);
    expect(diceSimilarity("", "x")).toBe(0);
  });

  test("equal empty strings return 1", () => {
    expect(diceSimilarity("", "")).toBe(1);
  });

  test("near-identical strings score > 0.85", () => {
    // "likes pizza" vs "likes piza" — single character typo
    const score = diceSimilarity("likes pizza", "likes piza");
    expect(score).toBeGreaterThan(0.85);
  });

  test("clearly different strings score < 0.85", () => {
    const score = diceSimilarity("email address", "phone number");
    expect(score).toBeLessThan(0.85);
  });

  test("typo variants score above typical threshold", () => {
    // "johnn smith" vs "john smith" — doubled character
    const score = diceSimilarity("johnn smith", "john smith");
    expect(score).toBeGreaterThan(0.85);
  });

  test("score is symmetric", () => {
    const ab = diceSimilarity("alpha bravo", "alpha beta");
    const ba = diceSimilarity("alpha beta", "alpha bravo");
    expect(ab).toBeCloseTo(ba, 10);
  });

  test("score is between 0 and 1 for arbitrary inputs", () => {
    const pairs = [
      ["foo bar", "foo baz"],
      ["nexus agent", "nexus assistant"],
      ["192.168.1.1", "192.168.1.2"],
    ] as [string, string][];
    for (const [a, b] of pairs) {
      const s = diceSimilarity(a, b);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  test("threshold boundary: score at 85% similarity", () => {
    // Verify values around the default 0.85 threshold make sense
    const high = diceSimilarity("lives in london", "lives in londone");  // very similar
    const low  = diceSimilarity("cat", "elephant");
    expect(high).toBeGreaterThan(low);
  });
});

// ── Fuzzy dedup integration tests via maintenance run ────────────────

const mockAddLog = jest.fn();
const mockGetAppConfig = jest.fn();
const mockSetAppConfig = jest.fn();

let dbRows: Array<{
  id: number;
  user_id: string | null;
  entity: string;
  attribute: string;
  value: string;
  last_updated: string;
  source_context: string | null;
}> = [];

let nextId = 1;

function makeDb() {
  return {
    exec: jest.fn(),
    prepare: jest.fn((sql: string) => ({
      run: jest.fn((...args: unknown[]) => {
        const flatArgs = args.flat() as unknown[];

        // DELETE empty entries
        if (/DELETE.*trim.*coalesce.*entity/i.test(sql)) {
          const before = dbRows.length;
          dbRows = dbRows.filter(
            (r) => r.entity.trim() && r.attribute.trim() && r.value.trim()
          );
          return { changes: before - dbRows.length };
        }

        // Exact dedup DELETE
        if (/DELETE.*JOIN user_knowledge k2/i.test(sql)) {
          const groups = new Map<string, typeof dbRows>();
          for (const r of dbRows) {
            const key = `${r.user_id ?? ""}|${r.entity.toLowerCase().trim()}|${r.attribute.toLowerCase().trim()}|${r.value.toLowerCase().trim()}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(r);
          }
          const toDelete = new Set<number>();
          for (const group of groups.values()) {
            if (group.length < 2) continue;
            // keep newest
            const sorted = [...group].sort((a, b) => b.last_updated.localeCompare(a.last_updated) || b.id - a.id);
            for (let i = 1; i < sorted.length; i++) toDelete.add(sorted[i].id);
          }
          const before = dbRows.length;
          dbRows = dbRows.filter((r) => !toDelete.has(r.id));
          return { changes: before - dbRows.length };
        }

        // Fuzzy dedup DELETE (batched: DELETE WHERE id IN (?,?,?))
        if (/DELETE FROM user_knowledge WHERE id IN/i.test(sql)) {
          const idsToDelete = new Set(flatArgs.map(Number));
          const before = dbRows.length;
          dbRows = dbRows.filter((r) => !idsToDelete.has(r.id));
          return { changes: before - dbRows.length };
        }

        // Trim source_context UPDATE
        if (/UPDATE user_knowledge.*source_context/i.test(sql)) {
          let changes = 0;
          dbRows = dbRows.map((r) => {
            if (r.source_context && r.source_context.length > 220) {
              changes++;
              return { ...r, source_context: r.source_context.slice(0, 220) };
            }
            return r;
          });
          return { changes };
        }

        return { changes: 0 };
      }),
      all: jest.fn(() => {
        // Return a copy sorted newest-first by last_updated DESC, id DESC
        return [...dbRows].sort(
          (a, b) =>
            b.last_updated.localeCompare(a.last_updated) || b.id - a.id
        );
      }),
    })),
  };
}

const mockDb = makeDb();

jest.mock("@/lib/db", () => ({
  addLog: (...args: unknown[]) => mockAddLog(...args),
  getAppConfig: (key: string) => mockGetAppConfig(key),
  setAppConfig: (key: string, value: string) => mockSetAppConfig(key, value),
  getDb: () => mockDb,
}));

function addRow(
  entity: string,
  attribute: string,
  value: string,
  opts: { userId?: string; lastUpdated?: string } = {}
) {
  dbRows.push({
    id: nextId++,
    user_id: opts.userId ?? null,
    entity,
    attribute,
    value,
    last_updated: opts.lastUpdated ?? new Date().toISOString(),
    source_context: null,
  });
}

function setupDefaultConfig(fuzzyEnabled = "1", threshold = "0.85") {
  mockGetAppConfig.mockImplementation((key: string) => {
    if (key === "knowledge_maintenance_enabled") return "1";
    if (key === "knowledge_maintenance_hour") return "0";    // always due
    if (key === "knowledge_maintenance_minute") return "0";
    if (key === "knowledge_maintenance_last_run_date") return null; // not run today
    if (key === "knowledge_maintenance_fuzzy_enabled") return fuzzyEnabled;
    if (key === "knowledge_maintenance_fuzzy_threshold") return threshold;
    return null;
  });
}

describe("fuzzy deduplication — maintenance run", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbRows = [];
    nextId = 1;
    // Re-attach prepare to fresh row state
    (mockDb.prepare as jest.Mock).mockImplementation(makeDb().prepare);
    setupDefaultConfig();
  });

  test("removes fuzzy-duplicate values within same entity+attribute group", async () => {
    // "hello world" vs "helo world" → Dice 0.947 > 0.85
    addRow("user", "greeting", "hello world", { lastUpdated: "2026-01-01T10:00:00Z" });
    addRow("user", "greeting", "helo world",  { lastUpdated: "2026-01-01T09:00:00Z" }); // older, similar

    const { runKnowledgeMaintenanceIfDue } = await import("@/lib/knowledge-maintenance");
    const result = await Promise.resolve(runKnowledgeMaintenanceIfDue(new Date("2026-01-01T20:05:00Z")));

    expect(result.skipped).toBe(false);
    expect(result.fuzzyDeduplicated).toBe(1);
    expect(dbRows.map((r) => r.value)).toContain("hello world");
    expect(dbRows.map((r) => r.value)).not.toContain("helo world");
  });

  test("keeps distinct values that are below the similarity threshold", async () => {
    addRow("contact", "email", "john@example.com");
    addRow("contact", "email", "jane@example.com");

    const { runKnowledgeMaintenanceIfDue } = await import("@/lib/knowledge-maintenance");
    const result = await Promise.resolve(runKnowledgeMaintenanceIfDue(new Date("2026-01-01T20:05:00Z")));

    expect(result.fuzzyDeduplicated).toBe(0);
    expect(dbRows).toHaveLength(2);
  });

  test("does not merge values from different entity+attribute groups", async () => {
    addRow("user", "first_name", "Jon");
    addRow("user", "last_name",  "Jon");  // same value, different attribute

    const { runKnowledgeMaintenanceIfDue } = await import("@/lib/knowledge-maintenance");
    const result = await Promise.resolve(runKnowledgeMaintenanceIfDue(new Date("2026-01-01T20:05:00Z")));

    expect(result.fuzzyDeduplicated).toBe(0);
    expect(dbRows).toHaveLength(2);
  });

  test("keeps the newer entry when a fuzzy duplicate is found", async () => {
    // "johnn smith" vs "john smith" → Dice 0.947 > 0.85
    addRow("user", "name", "johnn smith", { lastUpdated: "2026-01-02T10:00:00Z" }); // newer
    addRow("user", "name", "john smith",  { lastUpdated: "2026-01-01T10:00:00Z" }); // older

    const { runKnowledgeMaintenanceIfDue } = await import("@/lib/knowledge-maintenance");
    await Promise.resolve(runKnowledgeMaintenanceIfDue(new Date("2026-01-02T20:05:00Z")));

    expect(dbRows).toHaveLength(1);
    expect(dbRows[0].value).toBe("johnn smith");
  });

  test("fuzzyDeduplicated is 0 when fuzzy is disabled", async () => {
    setupDefaultConfig("0");
    addRow("user", "greeting", "hello world");
    addRow("user", "greeting", "helo world"); // similar but fuzzy disabled

    const { runKnowledgeMaintenanceIfDue } = await import("@/lib/knowledge-maintenance");
    const result = await Promise.resolve(runKnowledgeMaintenanceIfDue(new Date("2026-01-01T20:05:00Z")));

    expect(result.fuzzyDeduplicated).toBe(0);
    // Both entries remain (exact dedup doesn't catch them, fuzzy disabled)
    expect(dbRows).toHaveLength(2);
  });

  test("result includes fuzzyDeduplicated field on non-skipped runs", async () => {
    const { runKnowledgeMaintenanceIfDue } = await import("@/lib/knowledge-maintenance");
    const result = await Promise.resolve(runKnowledgeMaintenanceIfDue(new Date("2026-01-01T20:05:00Z")));

    expect(result).toHaveProperty("fuzzyDeduplicated");
    expect(typeof result.fuzzyDeduplicated).toBe("number");
  });
});
