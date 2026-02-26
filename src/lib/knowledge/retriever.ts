import { generateEmbedding } from "@/lib/llm/embeddings";
import {
  listKnowledgeEmbeddings,
  getKnowledgeEntriesByIds,
  searchKnowledge,
  type KnowledgeEntry,
} from "@/lib/db";

interface SemanticMatch {
  id: number;
  score: number;
}

// ─── Parsed Embedding Cache ──────────────────────────────────
// Avoids re-parsing JSON on every search call. Invalidated after a
// configurable TTL (30 s) so newly ingested knowledge is picked up.
interface EmbeddingCacheEntry {
  vectors: Map<number, number[]>;   // knowledge_id → parsed vector
  timestamp: number;
  userId: string | undefined;
}

let _embeddingCache: EmbeddingCacheEntry | null = null;
const EMBEDDING_CACHE_TTL_MS = 30_000; // 30 seconds

function getCachedEmbeddings(userId?: string): Map<number, number[]> {
  const now = Date.now();
  if (
    _embeddingCache &&
    _embeddingCache.userId === userId &&
    now - _embeddingCache.timestamp < EMBEDDING_CACHE_TTL_MS
  ) {
    return _embeddingCache.vectors;
  }

  const stored = listKnowledgeEmbeddings(userId);
  const vectors = new Map<number, number[]>();
  for (const row of stored) {
    const vec = parseEmbedding(row.embedding);
    if (vec && vec.length > 0) {
      vectors.set(row.knowledge_id, vec);
    }
  }

  _embeddingCache = { vectors, timestamp: now, userId };
  return vectors;
}

/** Invalidate the embedding cache (call after ingestion) */
export function invalidateEmbeddingCache(): void {
  _embeddingCache = null;
}

export async function retrieveKnowledge(query: string, limit = 6, userId?: string): Promise<KnowledgeEntry[]> {
  const semantic = await semanticSearch(query, limit, userId);
  const missing = limit - semantic.length;

  if (missing <= 0) {
    return semantic;
  }

  const fallback = keywordFallback(query, limit, userId);
  const merged = mergeEntries(semantic, fallback).slice(0, limit);
  return merged;
}

async function semanticSearch(query: string, limit: number, userId?: string): Promise<KnowledgeEntry[]> {
  const embedding = await generateEmbedding(query);
  if (embedding.length === 0) return [];

  const vectors = getCachedEmbeddings(userId);
  if (vectors.size === 0) return [];

  const matches: SemanticMatch[] = [];
  vectors.forEach((vector, knowledgeId) => {
    const score = cosineSimilarity(embedding, vector);
    if (Number.isFinite(score)) {
      matches.push({ id: knowledgeId, score });
    }
  });

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, limit);
  const ids = top.map((m) => m.id);
  const entries = getKnowledgeEntriesByIds(ids);
  const entryById = new Map(entries.map((e) => [e.id, e]));

  return top
    .map((m) => entryById.get(m.id))
    .filter((entry): entry is KnowledgeEntry => Boolean(entry));
}

function keywordFallback(query: string, limit: number, userId?: string): KnowledgeEntry[] {
  if (!query.trim()) return [];
  return searchKnowledge(query, userId).slice(0, limit);
}

function mergeEntries(primary: KnowledgeEntry[], secondary: KnowledgeEntry[]): KnowledgeEntry[] {
  const seen = new Set(primary.map((e) => e.id));
  const merged = [...primary];
  for (const entry of secondary) {
    if (!seen.has(entry.id)) {
      merged.push(entry);
      seen.add(entry.id);
    }
  }
  return merged;
}

function parseEmbedding(raw: string): number[] | null {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

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
