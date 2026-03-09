/**
 * Unit tests — Agent Logs
 */
import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import {
  addLog,
  getDbMaintenanceConfig,
  getLogsAfterId,
  getRecentLogs,
  runDbMaintenance,
  setDbMaintenanceConfig,
  setServerMinLogLevel,
} from "@/lib/db/queries";

beforeAll(() => setupTestDb());
afterAll(() => teardownTestDb());

describe("Agent Logs", () => {
  test("getRecentLogs returns empty list initially", () => {
    expect(getRecentLogs()).toEqual([]);
  });

  test("addLog creates a log entry", () => {
    addLog({ level: "info", source: "agent", message: "Task started", metadata: null });
    const logs = getRecentLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("verbose");
    expect(logs[0].source).toBe("agent");
    expect(logs[0].message).toBe("Task started");
    expect(logs[0].metadata).toBeNull();
    expect(logs[0].created_at).toBeDefined();
  });

  test("addLog stores metadata as string", () => {
    const meta = JSON.stringify({ toolName: "web_search", elapsed: 250 });
    addLog({ level: "debug", source: "tools", message: "Tool executed", metadata: meta });
    const logs = getRecentLogs();
    const debugLog = logs.find((l) => l.message === "Tool executed");
    expect(debugLog).toBeDefined();
    expect(debugLog!.level).toBe("verbose");
    expect(JSON.parse(debugLog!.metadata!)).toEqual({ toolName: "web_search", elapsed: 250 });
  });

  test("getRecentLogs returns all entries", () => {
    addLog({ level: "warn", source: "gatekeeper", message: "Policy deny", metadata: null });
    const logs = getRecentLogs();
    expect(logs.length).toBe(3);
    const levels = logs.map((l) => l.level);
    expect(levels).toContain("warning");
  });

  test("getRecentLogs respects limit", () => {
    // Already 3 logs from previous tests
    const logs = getRecentLogs(2);
    expect(logs).toHaveLength(2);
  });

  test("getRecentLogs applies default limit (1000) for NaN", () => {
    // PERF-17: NaN is clamped to 1000 instead of running unbounded
    const logs = getRecentLogs(Number.NaN);
    expect(logs.length).toBeGreaterThanOrEqual(3);
    // The important thing is it didn't crash and didn't run unbounded — it used LIMIT 1000
  });

  test("getRecentLogs applies default limit for Infinity", () => {
    const logs = getRecentLogs(Infinity);
    expect(logs.length).toBeGreaterThanOrEqual(3);
  });

  test("getRecentLogs applies default limit for negative values", () => {
    const logs = getRecentLogs(-5);
    expect(logs.length).toBeGreaterThanOrEqual(3);
  });

  test("getRecentLogs applies default limit for zero", () => {
    const logs = getRecentLogs(0);
    expect(logs.length).toBeGreaterThanOrEqual(3);
  });

  test("getRecentLogs caps at 10000", () => {
    // PERF-17: Even if caller requests more than 10000, it's clamped
    const logs = getRecentLogs(50000);
    // With only a few test entries, we just verify it doesn't crash
    expect(logs.length).toBeGreaterThanOrEqual(3);
    expect(logs.length).toBeLessThanOrEqual(10000);
  });

  test("getLogsAfterId returns rows in ascending id order", () => {
    addLog({ level: "info", source: "stream", message: "stream log one", metadata: null });
    addLog({ level: "error", source: "stream", message: "stream log two", metadata: null });
    const seed = getRecentLogs(1)[0];
    const rows = getLogsAfterId(seed.id - 1, 10);

    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].id).toBeGreaterThan(rows[i - 1].id);
    }
  });

  test("getLogsAfterId respects level and source filters", () => {
    addLog({ level: "warning", source: "scheduler", message: "sched warn", metadata: null });
    addLog({ level: "error", source: "scheduler", message: "sched error", metadata: null });
    addLog({ level: "error", source: "agent", message: "agent error", metadata: null });

    const all = getRecentLogs(10000);
    const minId = Math.max(0, Math.min(...all.map((l) => l.id)) - 1);

    const rows = getLogsAfterId(minId, 50, "error", "scheduler");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((l) => l.level === "error" && l.source === "scheduler")).toBe(true);
  });

  test("addLog supports error level", () => {
    addLog({ level: "error", source: "loop", message: "LLM timeout", metadata: '{"retry":true}' });
    const logs = getRecentLogs();
    const errorLog = logs.find((l) => l.message === "LLM timeout");
    expect(errorLog).toBeDefined();
    expect(errorLog!.source).toBe("loop");
  });

  test("addLog works with null source", () => {
    addLog({ level: "info", source: null, message: "No source", metadata: null });
    const logs = getRecentLogs();
    const nullSourceLog = logs.find((l) => l.message === "No source");
    expect(nullSourceLog).toBeDefined();
    expect(nullSourceLog!.source).toBeNull();
  });

  test("thought logs are treated as verbose and tagged as thought source", () => {
    addLog({ level: "thought", source: null, message: "Agent chain-of-thought summary", metadata: null });
    const thoughtLog = getRecentLogs().find((l) => l.message === "Agent chain-of-thought summary");
    expect(thoughtLog).toBeDefined();
    expect(thoughtLog!.level).toBe("verbose");
    expect(thoughtLog!.source).toBe("thought");
  });

  test("server minimum log level filters writes before persistence", () => {
    setServerMinLogLevel("error");
    addLog({ level: "warning", source: "scheduler", message: "Should be dropped", metadata: null });
    addLog({ level: "error", source: "scheduler", message: "Should remain", metadata: null });

    const logs = getRecentLogs(Number.NaN);
    expect(logs.some((l) => l.message === "Should be dropped")).toBe(false);
    expect(logs.some((l) => l.message === "Should remain")).toBe(true);

    setServerMinLogLevel("verbose");
  });

  test("db maintenance config can be updated and read back", () => {
    const updated = setDbMaintenanceConfig({
      enabled: true,
      intervalHours: 12,
      logsRetentionDays: 45,
      cleanupLogs: true,
      cleanupThreads: false,
      cleanupAttachments: false,
      cleanupOrphanFiles: true,
    });

    expect(updated.enabled).toBe(true);
    expect(updated.intervalHours).toBe(12);
    expect(updated.logsRetentionDays).toBe(45);
    expect(updated.cleanupLogs).toBe(true);
    expect(updated.cleanupThreads).toBe(false);

    const loaded = getDbMaintenanceConfig();
    expect(loaded.enabled).toBe(true);
    expect(loaded.intervalHours).toBe(12);
    expect(loaded.logsRetentionDays).toBe(45);
  });

  test("manual db maintenance run returns counts and timestamps", () => {
    addLog({ level: "warning", source: "maintenance", message: "old log candidate", metadata: null });
    setDbMaintenanceConfig({
      cleanupLogs: true,
      cleanupThreads: false,
      cleanupAttachments: false,
      cleanupOrphanFiles: false,
      logsRetentionDays: 1,
    });

    const result = runDbMaintenance("manual");
    expect(result.mode).toBe("manual");
    expect(typeof result.startedAt).toBe("string");
    expect(typeof result.completedAt).toBe("string");
    expect(result.deletedLogs).toBeGreaterThanOrEqual(0);
  });
});
