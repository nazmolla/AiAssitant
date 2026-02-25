/**
 * Integration tests — Policies API (/api/policies)
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/policies/route";

let adminId: string;
let userId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "admin-pol@example.com", role: "admin" });
  userId = seedTestUser({ email: "user-pol@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/policies", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin user", async () => {
    setMockUser({ id: userId, email: "user-pol@example.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("returns empty list for admin", async () => {
    setMockUser({ id: adminId, email: "admin-pol@example.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });
});

describe("POST /api/policies", () => {
  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "user-pol@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/policies", {
      method: "POST",
      body: JSON.stringify({ tool_name: "web_search" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test("returns 400 without tool_name", async () => {
    setMockUser({ id: adminId, email: "admin-pol@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/policies", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("creates a policy with approval required", async () => {
    setMockUser({ id: adminId, email: "admin-pol@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/policies", {
      method: "POST",
      body: JSON.stringify({
        tool_name: "file_write",
        requires_approval: true,
        is_proactive_enabled: false,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  test("created policy appears in list", async () => {
    setMockUser({ id: adminId, email: "admin-pol@example.com", role: "admin" });
    const res = await GET();
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].tool_name).toBe("file_write");
    expect(data[0].requires_approval).toBe(1);
  });

  test("upsert updates existing policy", async () => {
    setMockUser({ id: adminId, email: "admin-pol@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/policies", {
      method: "POST",
      body: JSON.stringify({
        tool_name: "file_write",
        requires_approval: false,
        is_proactive_enabled: true,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const list = await GET();
    const data = await list.json();
    expect(data.length).toBe(1);
    expect(data[0].requires_approval).toBe(0);
    expect(data[0].is_proactive_enabled).toBe(1);
  });
});
