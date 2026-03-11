/**
 * Integration tests — Logs API (/api/logs)
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, DELETE } from "@/app/api/logs/route";
import { addLog } from "@/lib/db/queries";

let adminId: string;
let userId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "log-admin@example.com", role: "admin" });
  userId = seedTestUser({ email: "log-user@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/logs", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const req = new NextRequest("http://localhost/api/logs");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "log-user@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/logs");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  test("returns empty log list for admin", async () => {
    setMockUser({ id: adminId, email: "log-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/logs");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("returns logs after adding entries", async () => {
    addLog({ level: "info", source: "agent", message: "Hello", metadata: null });
    addLog({ level: "error", source: "tool", message: "Fail", metadata: '{"code":500}' });

    setMockUser({ id: adminId, email: "log-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/logs");
    const res = await GET(req);
    const data = await res.json();
    expect(data.length).toBe(2);
    const levels = data.map((l: any) => l.level);
    expect(levels).toContain("verbose");
    expect(levels).toContain("error");
  });

  test("supports level filter", async () => {
    setMockUser({ id: adminId, email: "log-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/logs?level=error");
    const res = await GET(req);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.every((l: any) => l.level === "error")).toBe(true);
  });

  test("supports source filter", async () => {
    addLog({ level: "thought", source: null, message: "Thought trace", metadata: null });
    setMockUser({ id: adminId, email: "log-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/logs?source=thought");
    const res = await GET(req);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.every((l: any) => l.source === "thought")).toBe(true);
  });

  test("supports scheduler metadata filters (scheduleId/runId/taskRunId)", async () => {
    addLog({
      level: "info",
      source: "scheduler-engine",
      message: "Task run completed",
      metadata: JSON.stringify({ scheduleId: "sched-logs-1", runId: "run-logs-1", taskRunId: "task-logs-1", handlerName: "system.email.read_incoming" }),
    });
    addLog({
      level: "info",
      source: "scheduler-engine",
      message: "Task run completed",
      metadata: JSON.stringify({ scheduleId: "sched-logs-2", runId: "run-logs-2", taskRunId: "task-logs-2", handlerName: "system.proactive.scan" }),
    });

    setMockUser({ id: adminId, email: "log-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/logs?source=all&scheduleId=sched-logs-1&runId=run-logs-1&taskRunId=task-logs-1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.every((l: any) => String(l.metadata || "").includes("\"runId\":\"run-logs-1\""))).toBe(true);
    expect(data.every((l: any) => String(l.metadata || "").includes("\"taskRunId\":\"task-logs-1\""))).toBe(true);
    expect(data.every((l: any) => String(l.metadata || "").includes("\"scheduleId\":\"sched-logs-1\""))).toBe(true);
  });

  test("respects limit query parameter", async () => {
    setMockUser({ id: adminId, email: "log-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/logs?limit=1");
    const res = await GET(req);
    const data = await res.json();
    expect(data.length).toBe(1);
  });

  test("caps limit at 1000", async () => {
    setMockUser({ id: adminId, email: "log-admin@example.com", role: "admin" });
    // Passing a huge limit should be capped to 1000 internally
    const req = new NextRequest("http://localhost/api/logs?limit=9999");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  test("supports limit=all", async () => {
    setMockUser({ id: adminId, email: "log-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/logs?limit=all");
    const res = await GET(req);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test("falls back to default for invalid limit", async () => {
    setMockUser({ id: adminId, email: "log-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/logs?limit=not-a-number");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("supports cleanup by level", async () => {
    addLog({ level: "warning", source: "scheduler", message: "Cleanup me", metadata: null });
    setMockUser({ id: adminId, email: "log-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/logs", {
      method: "DELETE",
      body: JSON.stringify({ mode: "level", level: "warning" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});
