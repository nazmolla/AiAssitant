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

  test("returns discovered tool policies for admin", async () => {
    setMockUser({ id: adminId, email: "admin-pol@example.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    const names = data.map((p: any) => p.tool_name);
    expect(names).toContain("builtin.web_search");
    expect(names).toContain("builtin.email_send");
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
    const created = data.find((p: any) => p.tool_name === "file_write");
    expect(created).toBeDefined();
    expect(created.requires_approval).toBe(1);
  });

  test("upsert updates existing policy", async () => {
    setMockUser({ id: adminId, email: "admin-pol@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/policies", {
      method: "POST",
      body: JSON.stringify({
        tool_name: "file_write",
        requires_approval: false,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const list = await GET();
    const data = await list.json();
    const updated = data.find((p: any) => p.tool_name === "file_write");
    expect(updated).toBeDefined();
    expect(updated.requires_approval).toBe(0);
  });

  test("creates policy with scope=user", async () => {
    setMockUser({ id: adminId, email: "admin-pol@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/policies", {
      method: "POST",
      body: JSON.stringify({
        tool_name: "admin_tool",
        requires_approval: true,
        scope: "user",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const list = await GET();
    const data = await list.json();
    const policy = data.find((p: any) => p.tool_name === "admin_tool");
    expect(policy).toBeDefined();
    expect(policy.scope).toBe("user");
  });

  test("defaults scope to global when not specified", async () => {
    setMockUser({ id: adminId, email: "admin-pol@example.com", role: "admin" });
    const list = await GET();
    const data = await list.json();
    const policy = data.find((p: any) => p.tool_name === "file_write");
    expect(policy).toBeDefined();
    expect(policy.scope).toBe("global");
  });

  test("defaults invalid scope to global", async () => {
    setMockUser({ id: adminId, email: "admin-pol@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/policies", {
      method: "POST",
      body: JSON.stringify({
        tool_name: "bad_scope_tool",
        requires_approval: false,
        scope: "invalid",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const list = await GET();
    const data = await list.json();
    const policy = data.find((p: any) => p.tool_name === "bad_scope_tool");
    expect(policy).toBeDefined();
    expect(policy.scope).toBe("global");
  });
});
