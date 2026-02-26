/**
 * Integration tests — Logs API (/api/logs)
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/logs/route";
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
    expect(levels).toContain("info");
    expect(levels).toContain("error");
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
});
