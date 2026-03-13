import OpenAI from "openai";
import { createHash } from "crypto";
import { getDefaultLlmProvider } from "@/lib/db";
import { ConfigurationError } from "@/lib/errors";
import { EMBEDDING_CACHE_MAX_SIZE, EMBEDDING_CACHE_TTL_MS } from "@/lib/constants";

/* ── Embedding result cache (PERF-02) ────────────────────────────── */

interface CachedEmbedding {
  embedding: number[];
  cachedAt: number;
}

const embeddingCache = new Map<string, CachedEmbedding>();

function embeddingCacheKey(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/** Evict the oldest entry when the cache exceeds max size. */
function evictIfNeeded(): void {
  if (embeddingCache.size <= EMBEDDING_CACHE_MAX_SIZE) return;
  // Map iteration order = insertion order; delete the first (oldest) key
  const oldest = embeddingCache.keys().next().value;
  if (oldest !== undefined) embeddingCache.delete(oldest);
}

/** Clear the entire embedding cache. */
export function invalidateEmbeddingCache(): void {
  embeddingCache.clear();
}

/** Number of cached entries (for testing). */
export function getEmbeddingCacheSize(): number {
  return embeddingCache.size;
}

/**
 * Generates embeddings using the configured default embedding provider,
 * falling back to env vars when no DB provider is set.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Check cache
  const key = embeddingCacheKey(trimmed);
  const cached = embeddingCache.get(key);
  if (cached && Date.now() - cached.cachedAt < EMBEDDING_CACHE_TTL_MS) {
    // Move to end for LRU ordering
    embeddingCache.delete(key);
    embeddingCache.set(key, cached);
    return cached.embedding;
  }

  const dbProvider = getDefaultLlmProvider("embedding");
  if (!dbProvider) {
    throw new ConfigurationError("No embedding provider configured. Add one in Settings → LLM Providers.");
  }

  const result = await generateFromRecord(dbProvider, trimmed);

  // Store in cache
  embeddingCache.set(key, { embedding: result, cachedAt: Date.now() });
  evictIfNeeded();

  return result;
}

function generateFromRecord(
  record: { provider_type: string; config_json: string; label: string },
  text: string
): Promise<number[]> {
  const config = JSON.parse(record.config_json || "{}");

  if (record.provider_type === "azure-openai") {
    const apiKey = config.apiKey as string;
    const endpoint = (config.endpoint as string).replace(/\/$/, "");
    const deployment = config.deployment as string;
    if (!apiKey || !endpoint || !deployment) {
      throw new ConfigurationError(`Azure OpenAI embedding config for "${record.label}" is incomplete.`, { label: record.label });
    }
    const client = new OpenAI({
      apiKey,
      baseURL: `${endpoint}/openai/deployments/${deployment}`,
      defaultQuery: { "api-version": (config.apiVersion as string) || "2024-08-01-preview" },
      defaultHeaders: { "api-key": apiKey },
    });
    return client.embeddings
      .create({ model: deployment, input: text })
      .then((r) => r.data[0]?.embedding || []);
  }

  if (record.provider_type === "openai") {
    const apiKey = config.apiKey as string;
    if (!apiKey) {
      throw new ConfigurationError(`OpenAI embedding config for "${record.label}" is missing an API key.`, { label: record.label });
    }
    const client = new OpenAI({
      apiKey,
      baseURL: config.baseURL as string | undefined,
    });
    const model = (config.model as string) || "text-embedding-3-large";
    return client.embeddings
      .create({ model, input: text })
      .then((r) => r.data[0]?.embedding || []);
  }

  if (record.provider_type === "litellm") {
    const apiKey = (config.apiKey as string) || "no-key-required";
    let baseURL = config.baseURL as string;
    const model = (config.model as string) || "text-embedding-3-large";
    if (!baseURL) {
      throw new ConfigurationError(`LiteLLM embedding config for "${record.label}" is missing a Base URL.`, { label: record.label });
    }
    if (!baseURL.endsWith("/v1") && !baseURL.endsWith("/v1/")) {
      baseURL = baseURL.replace(/\/$/, "") + "/v1";
    }
    const client = new OpenAI({ apiKey, baseURL });
    return client.embeddings
      .create({ model, input: text })
      .then((r) => r.data[0]?.embedding || []);
  }

  throw new ConfigurationError(`Provider type "${record.provider_type}" does not support embeddings.`, { providerType: record.provider_type });
}
