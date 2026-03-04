/**
 * Unit tests for the AppCache module.
 *
 * Tests:
 * - Cache hit returns cached value without calling loader
 * - Cache miss calls loader and stores result
 * - TTL expiration triggers fresh load
 * - Invalidate removes specific key
 * - InvalidatePrefix removes matching keys
 * - InvalidateAll clears everything
 * - Async get works correctly
 * - Set pre-warms cache
 *
 * @jest-environment node
 */

import { appCache, CACHE_KEYS } from "@/lib/cache";

beforeEach(() => {
  appCache.invalidateAll();
});

describe("AppCache — basic operations", () => {
  test("cache miss calls loader and returns value", () => {
    const loader = jest.fn(() => [{ id: "p1", label: "GPT-4" }]);
    const result = appCache.get("test_key", loader);

    expect(result).toEqual([{ id: "p1", label: "GPT-4" }]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("cache hit returns cached value without calling loader", () => {
    const loader = jest.fn(() => "hello");
    appCache.get("test_key", loader);
    const result = appCache.get("test_key", loader);

    expect(result).toBe("hello");
    expect(loader).toHaveBeenCalledTimes(1); // only called once
  });

  test("TTL expiration triggers fresh load", () => {
    const loader = jest.fn(() => "value");
    appCache.get("test_key", loader, 0); // TTL 0 = always expired
    const result = appCache.get("test_key", loader, 0);

    expect(result).toBe("value");
    expect(loader).toHaveBeenCalledTimes(2); // called twice
  });

  test("cache returns undefined values correctly (no false-positive skipping)", () => {
    const loader = jest.fn(() => undefined);
    const result = appCache.get("test_key", loader);

    expect(result).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(1);

    // Second call should still return cached undefined
    const result2 = appCache.get("test_key", loader);
    expect(result2).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("AppCache — invalidation", () => {
  test("invalidate removes specific key", () => {
    const loader = jest.fn(() => "data");
    appCache.get("key1", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    appCache.invalidate("key1");
    appCache.get("key1", loader);
    expect(loader).toHaveBeenCalledTimes(2); // re-loaded after invalidation
  });

  test("invalidatePrefix removes matching keys", () => {
    appCache.get("user:1", () => "alice");
    appCache.get("user:2", () => "bob");
    appCache.get("other", () => "keep");

    appCache.invalidatePrefix("user:");

    const loader1 = jest.fn(() => "alice2");
    const loader2 = jest.fn(() => "bob2");
    const loader3 = jest.fn(() => "keep2");

    appCache.get("user:1", loader1);
    appCache.get("user:2", loader2);
    appCache.get("other", loader3);

    expect(loader1).toHaveBeenCalledTimes(1); // re-loaded
    expect(loader2).toHaveBeenCalledTimes(1); // re-loaded
    expect(loader3).toHaveBeenCalledTimes(0); // still cached
  });

  test("invalidateAll clears entire cache", () => {
    appCache.get("a", () => 1);
    appCache.get("b", () => 2);

    appCache.invalidateAll();

    const loaderA = jest.fn(() => 10);
    const loaderB = jest.fn(() => 20);

    appCache.get("a", loaderA);
    appCache.get("b", loaderB);

    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);
  });
});

describe("AppCache — set (pre-warm)", () => {
  test("set pre-warms cache so loader is not called", () => {
    appCache.set("warm_key", "pre-warmed");
    const loader = jest.fn(() => "from-loader");
    const result = appCache.get("warm_key", loader);

    expect(result).toBe("pre-warmed");
    expect(loader).toHaveBeenCalledTimes(0);
  });
});

describe("AppCache — async", () => {
  test("getAsync returns cached value on hit", async () => {
    const loader = jest.fn(async () => "async_value");
    await appCache.getAsync("async_key", loader);
    const result = await appCache.getAsync("async_key", loader);

    expect(result).toBe("async_value");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("getAsync calls loader on miss", async () => {
    const loader = jest.fn(async () => [1, 2, 3]);
    const result = await appCache.getAsync("async_key", loader);

    expect(result).toEqual([1, 2, 3]);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("AppCache — size diagnostics", () => {
  test("size reports number of cached entries", () => {
    expect(appCache.size).toBe(0);
    appCache.get("a", () => 1);
    appCache.get("b", () => 2);
    expect(appCache.size).toBe(2);
    appCache.invalidate("a");
    expect(appCache.size).toBe(1);
  });
});

describe("CACHE_KEYS — well-known keys", () => {
  test("CACHE_KEYS has expected keys", () => {
    expect(CACHE_KEYS.LLM_PROVIDERS).toBe("llm_providers");
    expect(CACHE_KEYS.TOOL_POLICIES).toBe("tool_policies");
    expect(CACHE_KEYS.USER_PREFIX).toBe("user:");
    expect(CACHE_KEYS.PROFILE_PREFIX).toBe("profile:");
  });
});
