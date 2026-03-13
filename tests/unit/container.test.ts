import { container } from "@/lib/container";
import type { ICache, ILogger } from "@/lib/container";

afterEach(() => {
  container.reset();
});

// ── Container core ───────────────────────────────────────────

describe("Container", () => {
  it("resolves a registered instance", () => {
    const mock: ICache = {
      get: jest.fn(() => "val"),
      getAsync: jest.fn(async () => "val"),
      set: jest.fn(),
      invalidate: jest.fn(),
      invalidatePrefix: jest.fn(),
      invalidateAll: jest.fn(),
      size: 0,
    };
    container.register("cache", mock);

    const resolved = container.resolve("cache");
    expect(resolved).toBe(mock);
  });

  it("returns the same singleton on repeated resolve calls", () => {
    const factory = jest.fn((): ICache => ({
      get: jest.fn(() => "x"),
      getAsync: jest.fn(async () => "x"),
      set: jest.fn(),
      invalidate: jest.fn(),
      invalidatePrefix: jest.fn(),
      invalidateAll: jest.fn(),
      size: 0,
    }));
    container.register("cache", factory);

    const a = container.resolve("cache");
    const b = container.resolve("cache");
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("falls back to default factory when no explicit registration exists", () => {
    const defaultCache: ICache = {
      get: jest.fn(() => "default"),
      getAsync: jest.fn(async () => "default"),
      set: jest.fn(),
      invalidate: jest.fn(),
      invalidatePrefix: jest.fn(),
      invalidateAll: jest.fn(),
      size: 0,
    };
    container.registerDefault("cache", () => defaultCache);

    expect(container.resolve("cache")).toBe(defaultCache);
  });

  it("explicit registration overrides default", () => {
    const defaultCache: ICache = {
      get: jest.fn(() => "default"),
      getAsync: jest.fn(async () => "default"),
      set: jest.fn(),
      invalidate: jest.fn(),
      invalidatePrefix: jest.fn(),
      invalidateAll: jest.fn(),
      size: 0,
    };
    const override: ICache = {
      get: jest.fn(() => "override"),
      getAsync: jest.fn(async () => "override"),
      set: jest.fn(),
      invalidate: jest.fn(),
      invalidatePrefix: jest.fn(),
      invalidateAll: jest.fn(),
      size: 0,
    };
    container.registerDefault("cache", () => defaultCache);
    container.register("cache", override);

    expect(container.resolve("cache")).toBe(override);
  });

  it("reset() clears explicit registrations and singletons", () => {
    const mock: ICache = {
      get: jest.fn(() => "mock"),
      getAsync: jest.fn(async () => "mock"),
      set: jest.fn(),
      invalidate: jest.fn(),
      invalidatePrefix: jest.fn(),
      invalidateAll: jest.fn(),
      size: 0,
    };
    const defaultCache: ICache = {
      get: jest.fn(() => "default"),
      getAsync: jest.fn(async () => "default"),
      set: jest.fn(),
      invalidate: jest.fn(),
      invalidatePrefix: jest.fn(),
      invalidateAll: jest.fn(),
      size: 0,
    };
    container.registerDefault("cache", () => defaultCache);
    container.register("cache", mock);
    expect(container.resolve("cache")).toBe(mock);

    container.reset();
    // After reset, should fall back to default
    expect(container.resolve("cache")).toBe(defaultCache);
  });

  it("throws when resolving an unregistered service with no default", () => {
    container.reset();
    // logger has no default registered in this test context
    expect(() => container.resolve("logger")).toThrow('No factory registered for service "logger"');
  });
});

// ── ICache interface compliance ──────────────────────────────

describe("ICache interface (AppCache)", () => {
  // Import the real AppCache
  let appCache: ICache;
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { appCache: realCache } = require("@/lib/cache");
    appCache = realCache;
    appCache.invalidateAll();
  });

  it("get() caches and returns values from loader", () => {
    const loader = jest.fn(() => 42);
    expect(appCache.get("test-key", loader)).toBe(42);
    expect(appCache.get("test-key", loader)).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("getAsync() caches async loaders", async () => {
    const loader = jest.fn(async () => "async-val");
    expect(await appCache.getAsync("async-key", loader)).toBe("async-val");
    expect(await appCache.getAsync("async-key", loader)).toBe("async-val");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("set() and invalidate() work", () => {
    appCache.set("k", "v");
    expect(appCache.get("k", () => "fallback")).toBe("v");
    appCache.invalidate("k");
    expect(appCache.get("k", () => "fallback")).toBe("fallback");
  });

  it("invalidateAll() clears everything", () => {
    appCache.set("a", 1);
    appCache.set("b", 2);
    expect(appCache.size).toBe(2);
    appCache.invalidateAll();
    expect(appCache.size).toBe(0);
  });

  it("invalidatePrefix() clears matching keys", () => {
    appCache.set("user:1", "alice");
    appCache.set("user:2", "bob");
    appCache.set("config:x", "val");
    appCache.invalidatePrefix("user:");
    expect(appCache.size).toBe(1);
    expect(appCache.get("config:x", () => "miss")).toBe("val");
  });
});

// ── ILogger interface compliance ─────────────────────────────

describe("ILogger mock injection", () => {
  it("can inject a mock logger and verify calls", () => {
    const mockLogger: ILogger = {
      log: jest.fn(),
      verbose: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
    };
    container.register("logger", mockLogger);

    const logger = container.resolve("logger");
    logger.verbose("test", "hello");
    logger.warning("test", "warn msg");
    logger.error("test", "err msg");

    expect(mockLogger.verbose).toHaveBeenCalledWith("test", "hello");
    expect(mockLogger.warning).toHaveBeenCalledWith("test", "warn msg");
    expect(mockLogger.error).toHaveBeenCalledWith("test", "err msg");
  });
});
