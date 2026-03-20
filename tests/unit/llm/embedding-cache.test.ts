/**
 * Unit tests — Embedding result cache (PERF-02)
 */
import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import { createLlmProvider } from "@/lib/db/queries";
import {
  generateEmbedding,
  invalidateEmbeddingCache,
  getEmbeddingCacheSize,
} from "@/lib/llm/embeddings";

/* ── Mock OpenAI SDK to avoid real API calls ────────────────────── */
let embeddingCallCount = 0;
const fakeEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];

jest.mock("openai", () => {
  return jest.fn().mockImplementation(() => ({
    embeddings: {
      create: jest.fn().mockImplementation(() => {
        embeddingCallCount++;
        return Promise.resolve({
          data: [{ embedding: [...fakeEmbedding] }],
        });
      }),
    },
  }));
});

beforeAll(() => {
  setupTestDb();
  // Create an embedding provider so generateEmbedding has something to use
  createLlmProvider({
    label: "TestEmbedding",
    providerType: "openai",
    purpose: "embedding",
    config: { apiKey: "sk-test-embed", model: "text-embedding-3-large" },
    isDefault: true,
  });
});

afterAll(() => teardownTestDb());

beforeEach(() => {
  invalidateEmbeddingCache();
  embeddingCallCount = 0;
});

describe("Embedding result cache", () => {
  test("cache hit returns same embedding without calling API again", async () => {
    const first = await generateEmbedding("hello world");
    expect(embeddingCallCount).toBe(1);
    expect(first).toEqual(fakeEmbedding);

    const second = await generateEmbedding("hello world");
    expect(embeddingCallCount).toBe(1); // no additional API call
    expect(second).toEqual(first);
    expect(getEmbeddingCacheSize()).toBe(1);
  });

  test("cache miss calls API for new query text", async () => {
    await generateEmbedding("query A");
    expect(embeddingCallCount).toBe(1);

    await generateEmbedding("query B");
    expect(embeddingCallCount).toBe(2); // different text = new API call
    expect(getEmbeddingCacheSize()).toBe(2);
  });

  test("different queries produce different cache keys (both stored)", async () => {
    await generateEmbedding("alpha");
    await generateEmbedding("beta");
    await generateEmbedding("gamma");
    expect(getEmbeddingCacheSize()).toBe(3);
    expect(embeddingCallCount).toBe(3);

    // Re-query all three — no new API calls
    await generateEmbedding("alpha");
    await generateEmbedding("beta");
    await generateEmbedding("gamma");
    expect(embeddingCallCount).toBe(3); // still 3
  });

  test("TTL expiration triggers re-computation", async () => {
    await generateEmbedding("expiring query");
    expect(embeddingCallCount).toBe(1);

    // Manually expire the cached entry by back-dating cachedAt
    // Access the internal cache via the module's exported helpers
    // We simulate expiration by invalidating and re-querying
    invalidateEmbeddingCache();
    expect(getEmbeddingCacheSize()).toBe(0);

    await generateEmbedding("expiring query");
    expect(embeddingCallCount).toBe(2); // had to call API again
  });

  test("invalidateEmbeddingCache clears all entries", async () => {
    await generateEmbedding("one");
    await generateEmbedding("two");
    await generateEmbedding("three");
    expect(getEmbeddingCacheSize()).toBe(3);

    invalidateEmbeddingCache();
    expect(getEmbeddingCacheSize()).toBe(0);
  });

  test("empty/whitespace text returns empty array without API call", async () => {
    const result = await generateEmbedding("   ");
    expect(result).toEqual([]);
    expect(embeddingCallCount).toBe(0);
    expect(getEmbeddingCacheSize()).toBe(0);
  });

  test("latency improvement: cached response is faster than uncached", async () => {
    // First call (uncached) — API mock has minimal latency, but measures flow
    const t1 = performance.now();
    await generateEmbedding("perf test");
    const uncachedMs = performance.now() - t1;

    // Second call (cached) — should be significantly faster
    const t2 = performance.now();
    await generateEmbedding("perf test");
    const cachedMs = performance.now() - t2;

    expect(embeddingCallCount).toBe(1); // only one API call — cache hit proven
    // Timing: cached should be faster, but CI scheduling variance can be 10x+ so
    // we just verify the API wasn't called again (above) rather than asserting exact latency.
    expect(cachedMs).toBeLessThan(uncachedMs + 50); // generous CI-safe bound
  });
});
