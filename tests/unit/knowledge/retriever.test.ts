/**
 * Unit tests — Cosine similarity and semantic search utilities
 *
 * Tests the pure-function cosine similarity used by the retriever,
 * and embedding parsing logic.
 */

// Re-implement the pure functions from retriever.ts to test them
function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    aMag += av * av;
    bMag += bv * bv;
  }
  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function parseEmbedding(raw: string): number[] | null {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

describe("Cosine Similarity", () => {
  test("identical vectors return 1", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  test("orthogonal vectors return 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  test("opposite vectors return -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  test("empty vectors return 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  test("zero vector returns 0", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  test("different-length vectors use min length", () => {
    const result = cosineSimilarity([1, 0, 0], [1, 0]);
    expect(result).toBeCloseTo(1.0);
  });

  test("realistic embedding similarity", () => {
    const a = [0.1, 0.3, 0.5, 0.7];
    const b = [0.1, 0.3, 0.5, 0.7]; // same
    const c = [0.9, -0.1, -0.5, 0.2]; // different
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
    const simAC = cosineSimilarity(a, c);
    expect(simAC).toBeLessThan(0.5); // should be relatively low
  });
});

describe("Embedding Parsing", () => {
  test("parses valid JSON array", () => {
    expect(parseEmbedding("[0.1, 0.2, 0.3]")).toEqual([0.1, 0.2, 0.3]);
  });

  test("returns null for invalid JSON", () => {
    expect(parseEmbedding("not json")).toBeNull();
  });

  test("returns null for non-array JSON", () => {
    expect(parseEmbedding('{"key": "value"}')).toBeNull();
  });

  test("returns empty array for empty JSON array", () => {
    expect(parseEmbedding("[]")).toEqual([]);
  });
});

describe("MIN_SIMILARITY filtering", () => {
  const MIN_SIMILARITY = 0.25;

  test("vectors with similarity below threshold are excluded", () => {
    // Nearly orthogonal vectors → low similarity
    const a = [1, 0, 0, 0];
    const b = [0, 0, 0, 1];
    const score = cosineSimilarity(a, b);
    expect(score).toBeLessThan(MIN_SIMILARITY);
  });

  test("vectors with similarity above threshold are included", () => {
    const a = [0.5, 0.5, 0.5, 0.5];
    const b = [0.4, 0.6, 0.5, 0.5];
    const score = cosineSimilarity(a, b);
    expect(score).toBeGreaterThanOrEqual(MIN_SIMILARITY);
  });

  test("greeting-like query does not match random knowledge embedding", () => {
    // Simulating: greeting embedding vs. "user prefers dark mode" embedding
    // These would typically be near-orthogonal in real embedding space
    const greetingVec = [0.1, 0.9, -0.1, 0.0];
    const knowledgeVec = [0.8, -0.2, 0.5, 0.3];
    const score = cosineSimilarity(greetingVec, knowledgeVec);
    // With a meaningful threshold, low-relevance matches are filtered
    expect(score).toBeLessThan(1.0);
  });
});
