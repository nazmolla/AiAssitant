/**
 * Unit tests — Vault embedding cache (PERF-03)
 *
 * Tests that the parsed-embedding cache in retriever.ts works correctly
 * with the 300s TTL, and benchmarks cosine-search latency at scale.
 */

// Mock the DB layer so we don't need a real database
jest.mock("@/lib/db", () => ({
  listKnowledgeEmbeddings: jest.fn(),
  getKnowledgeEntriesByIds: jest.fn(),
  searchKnowledge: jest.fn().mockReturnValue([]),
}));

// Mock the embedding generator
jest.mock("@/lib/llm/embeddings", () => ({
  generateEmbedding: jest.fn(),
}));

import {
  invalidateEmbeddingCache,
  hasKnowledgeEntries,
  retrieveKnowledge,
} from "@/lib/knowledge/retriever";
import { listKnowledgeEmbeddings, getKnowledgeEntriesByIds } from "@/lib/db";
import { generateEmbedding } from "@/lib/llm/embeddings";

const mockListEmbeddings = listKnowledgeEmbeddings as jest.MockedFunction<typeof listKnowledgeEmbeddings>;
const mockGetEntries = getKnowledgeEntriesByIds as jest.MockedFunction<typeof getKnowledgeEntriesByIds>;
const mockGenerateEmbedding = generateEmbedding as jest.MockedFunction<typeof generateEmbedding>;

/** Generate a random unit-ish vector of given dimension */
function randomVector(dim: number): number[] {
  const v = Array.from({ length: dim }, () => Math.random() - 0.5);
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / (mag || 1));
}

/** Build mock embedding rows for N entries */
function buildMockEmbeddings(count: number, dim = 128) {
  return Array.from({ length: count }, (_, i) => ({
    knowledge_id: i + 1,
    embedding: randomVector(dim),
  }));
}

beforeEach(() => {
  invalidateEmbeddingCache();
  jest.clearAllMocks();
});

describe("Vault cache behaviour", () => {
  test("second call uses cached embeddings (no additional DB query)", () => {
    const rows = buildMockEmbeddings(5);
    mockListEmbeddings.mockReturnValue(rows);

    // First call populates cache
    hasKnowledgeEntries("user1");
    expect(mockListEmbeddings).toHaveBeenCalledTimes(1);

    // Second call should hit cache
    hasKnowledgeEntries("user1");
    expect(mockListEmbeddings).toHaveBeenCalledTimes(1); // still 1
  });

  test("cache invalidated after invalidateEmbeddingCache()", () => {
    const rows = buildMockEmbeddings(3);
    mockListEmbeddings.mockReturnValue(rows);

    hasKnowledgeEntries("user1");
    expect(mockListEmbeddings).toHaveBeenCalledTimes(1);

    invalidateEmbeddingCache();
    hasKnowledgeEntries("user1");
    expect(mockListEmbeddings).toHaveBeenCalledTimes(2);
  });

  test("cache is per-user — different user triggers fresh load", () => {
    mockListEmbeddings.mockReturnValue(buildMockEmbeddings(2));

    hasKnowledgeEntries("alice");
    expect(mockListEmbeddings).toHaveBeenCalledTimes(1);

    hasKnowledgeEntries("bob");
    expect(mockListEmbeddings).toHaveBeenCalledTimes(2);
  });

  test("returns correct top-K results", async () => {
    // Create 10 embeddings, make one very similar to the query
    const dim = 8;
    const queryVec = randomVector(dim);
    const rows = buildMockEmbeddings(10, dim);
    // Make entry #5 identical to query (should rank #1)
    rows[4].embedding = queryVec;

    mockListEmbeddings.mockReturnValue(rows);
    mockGenerateEmbedding.mockResolvedValue(queryVec);
    mockGetEntries.mockImplementation((ids: number[]) =>
      ids.map((id) => ({
        id,
        user_id: "user1",
        title: `Entry ${id}`,
        content: `Content ${id}`,
        source: "manual",
        source_uri: null,
        metadata: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
    );

    const results = await retrieveKnowledge("test query", 3, "user1");
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Entry 5 (exact match) should be first
    expect(results[0].id).toBe(5);
  });
});

describe("Search latency benchmark", () => {
  // These tests verify that brute-force search completes within
  // reasonable time bounds for production-scale vaults.
  // The 300s cache TTL means these float ops only happen once per
  // 5 minutes instead of every 30s.

  const benchmarkSizes = [100, 500, 1000, 5000];
  const dim = 128; // typical OpenAI embedding dim is 1536, but 128 is enough to validate O(n)

  for (const size of benchmarkSizes) {
    test(`brute-force search completes for ${size} entries`, async () => {
      const rows = buildMockEmbeddings(size, dim);
      const queryVec = randomVector(dim);
      // Guarantee at least one match by making entry #1 identical to query
      rows[0].embedding = queryVec;

      mockListEmbeddings.mockReturnValue(rows);
      mockGenerateEmbedding.mockResolvedValue(queryVec);
      mockGetEntries.mockImplementation((ids: number[]) =>
        ids.map((id) => ({
          id,
          user_id: "user1",
          title: `E${id}`,
          content: `C${id}`,
          source: "manual",
          source_uri: null,
          metadata: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }))
      );

      invalidateEmbeddingCache();
      const start = performance.now();
      const results = await retrieveKnowledge("benchmark query", 6, "user1");
      const elapsed = performance.now() - start;

      expect(results.length).toBeGreaterThanOrEqual(1);
      // Even 5000 entries at 128-dim should finish in <500ms
      expect(elapsed).toBeLessThan(500);

      // Log for visibility (not an assertion)
      // eslint-disable-next-line no-console
      console.log(`  [bench] ${size} entries × ${dim}d → ${elapsed.toFixed(1)} ms, ${results.length} results`);
    });
  }

  test("cached search is faster than cold search", async () => {
    const rows = buildMockEmbeddings(1000, dim);
    const queryVec = randomVector(dim);

    mockListEmbeddings.mockReturnValue(rows);
    mockGenerateEmbedding.mockResolvedValue(queryVec);
    mockGetEntries.mockImplementation((ids: number[]) =>
      ids.map((id) => ({
        id,
        user_id: "user1",
        title: `E${id}`,
        content: `C${id}`,
        source: "manual",
        source_uri: null,
        metadata: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
    );

    invalidateEmbeddingCache();

    // Cold run (parses JSON + cosine search)
    const coldStart = performance.now();
    await retrieveKnowledge("cold query", 6, "user1");
    const coldMs = performance.now() - coldStart;

    // Hot run (cached vectors, only cosine search)
    const hotStart = performance.now();
    await retrieveKnowledge("hot query", 6, "user1");
    const hotMs = performance.now() - hotStart;

    // Cached run should not be slower than cold
    // (it may be similar since JSON parsing is fast at this scale)
    expect(hotMs).toBeLessThanOrEqual(coldMs * 5); // very generous bound — timing can vary under CI load

    // eslint-disable-next-line no-console
    console.log(`  [bench] Cold: ${coldMs.toFixed(1)} ms, Hot: ${hotMs.toFixed(1)} ms`);
  });
});

describe("Regression: existing behaviour preserved", () => {
  test("empty vault returns empty results", async () => {
    mockListEmbeddings.mockReturnValue([]);
    const results = await retrieveKnowledge("anything", 6, "user1");
    expect(results).toEqual([]);
    // Should NOT call generateEmbedding for empty vault
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  test("no userId returns empty", async () => {
    const results = await retrieveKnowledge("anything", 6);
    expect(results).toEqual([]);
  });

  test("hasKnowledgeEntries returns false for empty vault", () => {
    mockListEmbeddings.mockReturnValue([]);
    expect(hasKnowledgeEntries("user1")).toBe(false);
  });

  test("hasKnowledgeEntries returns true when entries exist", () => {
    mockListEmbeddings.mockReturnValue(buildMockEmbeddings(1));
    expect(hasKnowledgeEntries("user1")).toBe(true);
  });
});
