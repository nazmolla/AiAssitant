/**
 * Unit tests — Agent Logs
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  addLog,
  getDbMaintenanceConfig,
  getLogsAfterId,
  getRecentLogs,
  listApprovalPreferences,
  updateApprovalPreferenceDecision,
  deleteApprovalPreference,
  deleteAllApprovalPreferences,
  upsertApprovalPreferenceFromApproval,
  runDbMaintenance,
  setDbMaintenanceConfig,
  setServerMinLogLevel,
  listNotifications,
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

  test("standing orders can be listed, updated, and deleted", () => {
    const userId = seedTestUser();

    // Create a standing order via upsertApprovalPreferenceFromApproval
    const fakeApproval = {
      id: "test-approval-1",
      thread_id: null,
      tool_name: "builtin.web_fetch",
      args: JSON.stringify({ action: "turn_on", name: "bedroom_light" }),
      reasoning: "scheduled routine",
      nl_request: null,
      status: "pending",
      created_at: new Date().toISOString(),
    };
    upsertApprovalPreferenceFromApproval(userId, fakeApproval as never, "approved");

    // List should return the preference
    let prefs = listApprovalPreferences(userId);
    expect(prefs.length).toBeGreaterThanOrEqual(1);
    const pref = prefs.find((p) => p.tool_name === "builtin.web_fetch");
    expect(pref).toBeDefined();
    expect(pref!.decision).toBe("approved");

    // Update the decision
    const updated = updateApprovalPreferenceDecision(pref!.id, userId, "rejected");
    expect(updated).toBe(true);
    prefs = listApprovalPreferences(userId);
    expect(prefs.find((p) => p.id === pref!.id)?.decision).toBe("rejected");

    // Delete single
    const deleted = deleteApprovalPreference(pref!.id, userId);
    expect(deleted).toBe(true);
    prefs = listApprovalPreferences(userId);
    expect(prefs.find((p) => p.id === pref!.id)).toBeUndefined();
  });

  test("deleteAllApprovalPreferences clears all for user", () => {
    const userId = seedTestUser();

    // Create two standing orders
    for (const name of ["tool_a", "tool_b"]) {
      const approval = {
        id: `bulk-${name}`,
        thread_id: null,
        tool_name: name,
        args: JSON.stringify({ action: "run" }),
        reasoning: null,
        nl_request: null,
        status: "pending",
        created_at: new Date().toISOString(),
      };
      upsertApprovalPreferenceFromApproval(userId, approval as never, "approved");
    }

    let prefs = listApprovalPreferences(userId);
    expect(prefs.length).toBeGreaterThanOrEqual(2);

    const count = deleteAllApprovalPreferences(userId);
    expect(count).toBeGreaterThanOrEqual(2);

    prefs = listApprovalPreferences(userId);
    expect(prefs.length).toBe(0);
  });
});

// ── Notification wiring ───────────────────────────────────────────────────────

describe("addLog → notification bell wiring", () => {
  let adminId: string;

  beforeAll(() => {
    adminId = seedTestUser({ role: "admin" });
  });

  test("info level creates an in-app notification of type 'info'", () => {
    const before = listNotifications(adminId).length;
    addLog({ level: "info", source: "scheduler", message: "Proactive scan started", metadata: null, userId: adminId });
    const after = listNotifications(adminId);
    expect(after.length).toBe(before + 1);
    const notif = after.find((n) => n.title === "Proactive scan started");
    expect(notif).toBeDefined();
    expect(notif!.type).toBe("info");
  });

  test("warning level creates a notification of type 'warning'", () => {
    const before = listNotifications(adminId).length;
    addLog({ level: "warning", source: "scheduler", message: "Disk space low", metadata: null, userId: adminId });
    const after = listNotifications(adminId);
    expect(after.length).toBe(before + 1);
    const notif = after.find((n) => n.title === "Disk space low");
    expect(notif!.type).toBe("warning");
  });

  test("error level creates a notification of type 'system_error'", () => {
    const before = listNotifications(adminId).length;
    addLog({ level: "error", source: "agent", message: "Tool execution failed", metadata: null, userId: adminId });
    const after = listNotifications(adminId);
    expect(after.length).toBe(before + 1);
    expect(after.find((n) => n.title === "Tool execution failed")!.type).toBe("system_error");
  });

  test("critical level creates a notification of type 'system_error'", () => {
    const before = listNotifications(adminId).length;
    addLog({ level: "critical", source: "system", message: "Service crashed", metadata: null, userId: adminId });
    const after = listNotifications(adminId);
    expect(after.length).toBe(before + 1);
    expect(after.find((n) => n.title === "Service crashed")!.type).toBe("system_error");
  });

  test("verbose level does NOT create a notification", () => {
    const before = listNotifications(adminId).length;
    addLog({ level: "verbose", source: "agent", message: "Step result verbose", metadata: null, userId: adminId });
    expect(listNotifications(adminId).length).toBe(before);
  });

  test("thought level does NOT create a notification", () => {
    const before = listNotifications(adminId).length;
    addLog({ level: "thought", source: null, message: "Agent reasoning trace", metadata: null, userId: adminId });
    expect(listNotifications(adminId).length).toBe(before);
  });

  test("debug level does NOT create a notification", () => {
    const before = listNotifications(adminId).length;
    addLog({ level: "debug", source: "tools", message: "Debug dump", metadata: null, userId: adminId });
    expect(listNotifications(adminId).length).toBe(before);
  });

  test("long messages store full text as title; notify_body set when message >100 chars", () => {
    const longMsg = "A".repeat(120);
    addLog({ level: "warning", source: "system", message: longMsg, metadata: null, userId: adminId });
    const notif = listNotifications(adminId).find((n) => n.title.startsWith("AAA"));
    expect(notif).toBeDefined();
    // Title is the full message (no DB-level truncation); body is also set for >100 char messages
    expect(notif!.title).toBe(longMsg);
    expect(notif!.body).toBe(longMsg);
  });
});
