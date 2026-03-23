/**
 * Integration tests — Threads API (/api/threads)
 *
 * Tests the route handlers directly with a mocked auth layer
 * and a real in-memory SQLite database.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";

// Install auth mocks BEFORE importing route modules
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/threads/route";
import {
  GET as GET_THREAD,
  DELETE as DELETE_THREAD,
} from "@/app/api/threads/[threadId]/route";
import { getRecentLogs } from "@/lib/db/queries";
import { setServerMinLogLevel } from "@/lib/db/log-queries";

let userId: string;
let adminId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "threads@example.com", role: "user" });
  adminId = seedTestUser({ email: "admin@example.com", role: "admin" });
});
afterAll(() => teardownTestDb());

describe("GET /api/threads", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET(new NextRequest("http://localhost/api/threads"));
    expect(res.status).toBe(401);
  });

  test("returns empty list for new user", async () => {
    setMockUser({ id: userId, email: "threads@example.com", role: "user" });
    const res = await GET(new NextRequest("http://localhost/api/threads"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.hasMore).toBe(false);
  });
});

describe("POST /api/threads", () => {
  test("creates a thread", async () => {
    setMockUser({ id: userId, email: "threads@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/threads", {
      method: "POST",
      body: JSON.stringify({ title: "My thread" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.title).toBe("My thread");
    expect(data.user_id).toBe(userId);
  });

  test("created thread appears in GET list", async () => {
    setMockUser({ id: userId, email: "threads@example.com", role: "user" });
    const res = await GET(new NextRequest("http://localhost/api/threads"));
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].title).toBe("My thread");
  });

  test("user cannot see another user's threads", async () => {
    setMockUser({ id: adminId, email: "admin@example.com", role: "admin" });
    const res = await GET(new NextRequest("http://localhost/api/threads"));
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});

describe("GET /api/threads/[threadId]", () => {
  let threadId: string;

  beforeAll(async () => {
    setMockUser({ id: userId, email: "threads@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Detail thread" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    const data = await res.json();
    threadId = data.id;
  });

  test("returns thread with messages", async () => {
    setMockUser({ id: userId, email: "threads@example.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/threads/${threadId}`);
    const res = await GET_THREAD(req, { params: { threadId } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.thread.id).toBe(threadId);
    expect(data.messages).toEqual([]);
  });

  test("returns 404 for non-existent thread", async () => {
    setMockUser({ id: userId, email: "threads@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/threads/no-such-id");
    const res = await GET_THREAD(req, { params: { threadId: "no-such-id" } });
    expect(res.status).toBe(404);
  });

  test("returns 403 when accessing another user's thread", async () => {
    setMockUser({ id: adminId, email: "admin@example.com", role: "admin" });
    const req = new NextRequest(`http://localhost/api/threads/${threadId}`);
    const res = await GET_THREAD(req, { params: { threadId } });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/threads/[threadId]", () => {
  let threadId: string;

  beforeAll(async () => {
    setMockUser({ id: userId, email: "threads@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/threads", {
      method: "POST",
      body: JSON.stringify({ title: "To delete" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    const data = await res.json();
    threadId = data.id;
  });

  test("returns 403 when deleting another user's thread", async () => {
    setMockUser({ id: adminId, email: "admin@example.com", role: "admin" });
    const req = new NextRequest(`http://localhost/api/threads/${threadId}`, { method: "DELETE" });
    const res = await DELETE_THREAD(req, { params: { threadId } });
    expect(res.status).toBe(403);
  });

  test("deletes own thread", async () => {
    setMockUser({ id: userId, email: "threads@example.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/threads/${threadId}`, { method: "DELETE" });
    const res = await DELETE_THREAD(req, { params: { threadId } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("returns 404 after deletion", async () => {
    setMockUser({ id: userId, email: "threads@example.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/threads/${threadId}`);
    const res = await GET_THREAD(req, { params: { threadId } });
    expect(res.status).toBe(404);
  });
});

// PERF-20: Verify read-path logging was removed
describe("GET /api/threads — logging", () => {
  test("GET does not write log entries (PERF-20)", async () => {
    setMockUser({ id: userId, email: "threads@example.com", role: "user" });
    // Capture log count before GET
    const logsBefore = getRecentLogs(10000);
    const countBefore = logsBefore.filter(
      (l) => l.source === "api.threads" && l.message === "Fetched threads list."
    ).length;

    // Make several GET requests
    await GET(new NextRequest("http://localhost/api/threads"));
    await GET(new NextRequest("http://localhost/api/threads"));
    await GET(new NextRequest("http://localhost/api/threads"));

    // Count again — should NOT have increased
    const logsAfter = getRecentLogs(10000);
    const countAfter = logsAfter.filter(
      (l) => l.source === "api.threads" && l.message === "Fetched threads list."
    ).length;
    expect(countAfter).toBe(countBefore);
  });

  test("POST still writes log entries", async () => {
    setServerMinLogLevel("verbose"); // ensure verbose logs are retained for this test
    setMockUser({ id: userId, email: "threads@example.com", role: "user" });
    const logsBefore = getRecentLogs(10000);
    const countBefore = logsBefore.filter(
      (l) => l.source === "api.threads" && l.message === "Created new thread."
    ).length;

    const req = new NextRequest("http://localhost/api/threads", {
      method: "POST",
      body: JSON.stringify({ title: "Log test thread" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const logsAfter = getRecentLogs(10000);
    const countAfter = logsAfter.filter(
      (l) => l.source === "api.threads" && l.message === "Created new thread."
    ).length;
    expect(countAfter).toBeGreaterThan(countBefore);
  });
});
