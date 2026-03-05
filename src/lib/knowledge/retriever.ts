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

/** Fast check: does this user have any knowledge embeddings? (uses cache, no API call) */
export function hasKnowledgeEntries(userId?: string): boolean {
  if (!userId) return false;
  return getCachedEmbeddings(userId).size > 0;
}

// ─── Knowledge Relevance Filter ─────────────────────────────
// Skip knowledge retrieval for messages that clearly don't need it
// (greetings, chitchat, acknowledgments, meta-questions, etc.)

const NO_KNOWLEDGE_SIGNALS = [
  // Greetings
  /^\s*(h(i|ello|ey|owdy|ola)|yo|sup|what'?s\s*up|good\s*(morning|afternoon|evening|night)|g'?day|ahlan|marhaba|salam)\s*[!.?]*\s*$/i,
  // Acknowledgments
  /^\s*(ok(ay)?|sure|thanks?|thank\s*you|thx|ty|got\s*it|understood|roger|cool|nice|great|awesome|perfect|alright|np|no\s*problem|you'?re\s*welcome|cheers)\s*[!.?]*\s*$/i,
  // Farewell
  /^\s*(bye|goodbye|good\s*bye|see\s*y(a|ou)|later|take\s*care|cya|peace|night|gn)\s*[!.?]*\s*$/i,
  // Meta questions about the agent itself
  /^\s*(who|what)\s+(are|r)\s+(you|u)\s*[!.?]*$/i,
  /^\s*what\s+(can|do)\s+you\s+do\s*[!.?]*$/i,
  /^\s*how\s+(are|r)\s+(you|u)(\s+doing)?\s*[!.?]*$/i,
  // Simple pleasantries / empty
  /^\s*[!.?]*\s*$/,
  /^\s*(lol|haha|hehe|lmao|rofl|xd|😂|😄|👋|🙏)\s*$/i,
  // Yes/no answers with no substance
  /^\s*(yes|no|yep|nope|yeah|nah|yea|nay)\s*[!.?]*\s*$/i,
];

/**
 * Determine whether a user message warrants searching the knowledge vault.
 * Returns false for greetings, chitchat, and other messages that clearly
 * don't benefit from knowledge context — avoids a wasted embedding API call.
 */
export function needsKnowledgeRetrieval(message: string): boolean {
  if (!message || message.trim().length === 0) return false;
  return !NO_KNOWLEDGE_SIGNALS.some((r) => r.test(message));
}

export async function retrieveKnowledge(query: string, limit = 6, userId?: string): Promise<KnowledgeEntry[]> {
  if (!userId) return [];

  const semantic = await semanticSearch(query, limit, userId);
  const missing = limit - semantic.length;

  if (missing <= 0) {
    return semantic;
  }

  const fallback = keywordFallback(query, limit, userId);
  const merged = mergeEntries(semantic, fallback).slice(0, limit);
  return merged;
}

const MIN_SIMILARITY = 0.25;

async function semanticSearch(query: string, limit: number, userId?: string): Promise<KnowledgeEntry[]> {
  // Check cached embeddings FIRST to avoid an expensive API call when vault is empty
  const vectors = getCachedEmbeddings(userId);
  if (vectors.size === 0) return [];

  const embedding = await generateEmbedding(query);
  if (embedding.length === 0) return [];

  const matches: SemanticMatch[] = [];
  vectors.forEach((vector, knowledgeId) => {
    const score = cosineSimilarity(embedding, vector);
    if (Number.isFinite(score) && score >= MIN_SIMILARITY) {
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
