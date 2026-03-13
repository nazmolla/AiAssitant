import type { ICache } from "@/lib/container";
import { container } from "@/lib/container";

/**
 * Application-level in-memory cache for frequently-read, rarely-changed data.
 *
 * Designed for data that is read on EVERY request but only written when
 * admin settings change (LLM providers, tool policies, user roles, profiles).
 *
 * Two invalidation strategies work together:
 *  1. **Explicit invalidation** — mutation functions call `appCache.invalidate()`
 *     when they modify data (primary mechanism, instant).
 *  2. **TTL expiration** — safety net in case a mutation path misses
 *     invalidation (default 60 seconds).
 *
 * This is NOT a distributed cache — it lives in the Node.js process memory.
 * That's fine for Nexus (single-process deployment).
 */

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

import { CACHE_DEFAULT_TTL_MS } from "@/lib/constants";

class AppCache implements ICache {
  private entries = new Map<string, CacheEntry<unknown>>();

  /**
   * Get a cached value, or load it fresh via `loader` if missing/expired.
   * `loader` is only called when the cache misses.
   */
  get<T>(key: string, loader: () => T, ttlMs: number = CACHE_DEFAULT_TTL_MS): T {
    const entry = this.entries.get(key);
    const now = Date.now();
    if (entry && (now - entry.cachedAt) < ttlMs) {
      return entry.data as T;
    }
    const data = loader();
    this.entries.set(key, { data, cachedAt: now });
    return data;
  }

  /**
   * Async version of `get` for loaders that return a Promise.
   */
  async getAsync<T>(key: string, loader: () => Promise<T>, ttlMs: number = CACHE_DEFAULT_TTL_MS): Promise<T> {
    const entry = this.entries.get(key);
    const now = Date.now();
    if (entry && (now - entry.cachedAt) < ttlMs) {
      return entry.data as T;
    }
    const data = await loader();
    this.entries.set(key, { data, cachedAt: now });
    return data;
  }

  /** Manually set a cache entry (useful after a mutation to pre-warm). */
  set<T>(key: string, data: T): void {
    this.entries.set(key, { data, cachedAt: Date.now() });
  }

  /** Invalidate a specific key. */
  invalidate(key: string): void {
    this.entries.delete(key);
  }

  /** Invalidate all keys matching a prefix. */
  invalidatePrefix(prefix: string): void {
    const keysToDelete: string[] = [];
    this.entries.forEach((_, key) => {
      if (key.startsWith(prefix)) keysToDelete.push(key);
    });
    keysToDelete.forEach((key) => this.entries.delete(key));
  }

  /** Flush the entire cache. */
  invalidateAll(): void {
    this.entries.clear();
  }

  /** Number of cached entries (for diagnostics). */
  get size(): number {
    return this.entries.size;
  }
}

/** Singleton cache instance for the application. */
export const appCache = new AppCache();

/** Create a new isolated AppCache instance (useful for testing). */
export function createCache(): AppCache {
  return new AppCache();
}

/** Reset the singleton cache (clears all entries). */
export function resetCache(): void {
  appCache.invalidateAll();
}

/**
 * Well-known cache keys. Using constants prevents typo bugs
 * and makes it easy to grep for all cache usage.
 */
export const CACHE_KEYS = {
  /** All configured LLM providers (decrypted). */
  LLM_PROVIDERS: "llm_providers",
  /** All tool policies. */
  TOOL_POLICIES: "tool_policies",
  /** Per-user role/record. Key: `user:{userId}` */
  USER_PREFIX: "user:",
  /** Per-user profile. Key: `profile:{userId}` */
  PROFILE_PREFIX: "profile:",
  /** User lookup by email. Key: `user_email:{normalised_email}` */
  USER_BY_EMAIL_PREFIX: "user_email:",
  /** User lookup by external sub ID. Key: `user_sub:{subId}` */
  USER_BY_SUB_PREFIX: "user_sub:",
  /** Channels (decrypted). Key: `channels:{userId|_all}` */
  CHANNELS_PREFIX: "channels:",
  /** Auth providers (decrypted). */
  AUTH_PROVIDERS: "auth_providers",
  /** MCP servers (decrypted). Key: `mcp_servers:{userId|_all}` */
  MCP_SERVERS_PREFIX: "mcp_servers:",
} as const;

// Register AppCache as the default ICache implementation
container.registerDefault("cache", () => appCache);
