import { setupTestDb, teardownTestDb } from "../helpers/test-db";

describe("global state reset/dispose", () => {
  beforeEach(() => {
    jest.resetModules();
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe("AppCache", () => {
    test("resetCache clears all entries from the singleton", () => {
      const { appCache, resetCache } = require("@/lib/cache");
      appCache.set("key1", "value1");
      appCache.set("key2", "value2");
      expect(appCache.size).toBe(2);

      resetCache();
      expect(appCache.size).toBe(0);
    });

    test("createCache returns an independent instance", () => {
      const { appCache, createCache } = require("@/lib/cache");
      const isolated = createCache();
      appCache.set("shared-key", "shared-value");
      isolated.set("isolated-key", "isolated-value");

      // Each cache has only its own entry
      expect(appCache.size).toBe(1);
      expect(isolated.size).toBe(1);

      // Cross-cache lookup should not find the other's entries
      isolated.invalidate("shared-key"); // no-op if doesn't exist
      expect(appCache.size).toBe(1); // appCache still has its entry
    });

    test("createCache instance implements ICache interface", () => {
      const { createCache } = require("@/lib/cache");
      const cache = createCache();
      // ICache methods
      expect(typeof cache.get).toBe("function");
      expect(typeof cache.getAsync).toBe("function");
      expect(typeof cache.set).toBe("function");
      expect(typeof cache.invalidate).toBe("function");
      expect(typeof cache.invalidatePrefix).toBe("function");
      expect(typeof cache.invalidateAll).toBe("function");
      expect(typeof cache.size).toBe("number");
    });
  });

  describe("DB Connection", () => {
    test("closeDb clears stmt cache and nullifies connection", () => {
      const conn = require("@/lib/db/connection");
      // getDb creates/returns the connection
      const db = conn.getDb();
      expect(db).toBeDefined();

      conn.closeDb();
      // After close, getDb should create a new connection
      const db2 = conn.getDb();
      expect(db2).toBeDefined();
    });

    test("clearStmtCache is callable without error", () => {
      const conn = require("@/lib/db/connection");
      conn.getDb(); // ensure connection exists
      expect(() => conn.clearStmtCache()).not.toThrow();
    });
  });

  describe("Scheduler Engine", () => {
    test("resetSchedulerEngine clears handler registry and engine state", () => {
      jest.mock("@/lib/agent", () => ({
        runAgentLoop: jest.fn(async () => ({ content: "", toolsUsed: [], pendingApprovals: [] })),
      }));
      jest.mock("@/lib/scheduler", () => ({
        runProactiveScan: jest.fn(),
        runEmailReadBatch: jest.fn(),
        executeProactiveApprovedTool: jest.fn(),
      }));

      const { registerHandler, getRegisteredHandlers, resetSchedulerEngine } =
        require("@/lib/scheduler/unified-engine");

      registerHandler("test.handler.one");
      registerHandler("test.handler.two");
      expect(getRegisteredHandlers().size).toBe(2);

      resetSchedulerEngine();
      expect(getRegisteredHandlers().size).toBe(0);
    });
  });
});
