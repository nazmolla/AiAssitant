/**
 * Unit tests — Agent Logs
 */
import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import { addLog, getRecentLogs } from "@/lib/db/queries";

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
    expect(logs[0].level).toBe("info");
    expect(logs[0].source).toBe("agent");
    expect(logs[0].message).toBe("Task started");
    expect(logs[0].metadata).toBeNull();
    expect(logs[0].created_at).toBeDefined();
  });

  test("addLog stores metadata as string", () => {
    const meta = JSON.stringify({ toolName: "web_search", elapsed: 250 });
    addLog({ level: "debug", source: "tools", message: "Tool executed", metadata: meta });
    const logs = getRecentLogs();
    const debugLog = logs.find((l) => l.level === "debug");
    expect(debugLog).toBeDefined();
    expect(JSON.parse(debugLog!.metadata!)).toEqual({ toolName: "web_search", elapsed: 250 });
  });

  test("getRecentLogs returns all entries", () => {
    addLog({ level: "warn", source: "gatekeeper", message: "Policy deny", metadata: null });
    const logs = getRecentLogs();
    expect(logs.length).toBe(3);
    const levels = logs.map((l) => l.level);
    expect(levels).toContain("warn");
  });

  test("getRecentLogs respects limit", () => {
    // Already 3 logs from previous tests
    const logs = getRecentLogs(2);
    expect(logs).toHaveLength(2);
  });

  test("addLog supports error level", () => {
    addLog({ level: "error", source: "loop", message: "LLM timeout", metadata: '{"retry":true}' });
    const logs = getRecentLogs();
    const errorLog = logs.find((l) => l.level === "error");
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
});
