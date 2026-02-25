/**
 * Integration tests — Admin Users API (/api/admin/users)
 *
 * Tests user listing, role/status updates, permission management,
 * and deletion with admin-only enforcement.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, PUT, DELETE } from "@/app/api/admin/users/route";

let adminId: string;
let userId: string;
let targetUserId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "admin-users@test.com", role: "admin" });
  userId = seedTestUser({ email: "user-users@test.com", role: "user" });
  targetUserId = seedTestUser({ email: "target@test.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/admin/users", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "user-users@test.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("admin can list all users", async () => {
    setMockUser({ id: adminId, email: "admin-users@test.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(3);
    // Password hashes should be stripped
    expect(data.every((u: any) => u.password_hash === undefined)).toBe(true);
  });
});

describe("PUT /api/admin/users", () => {
  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "user-users@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: targetUserId, role: "admin" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(403);
  });

  test("returns 400 without userId", async () => {
    setMockUser({ id: adminId, email: "admin-users@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ role: "admin" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 with invalid userId format", async () => {
    setMockUser({ id: adminId, email: "admin-users@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: "not-a-uuid", role: "admin" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  test("admin cannot demote themselves", async () => {
    setMockUser({ id: adminId, email: "admin-users@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: adminId, role: "user" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("own role");
  });

  test("admin cannot disable themselves", async () => {
    setMockUser({ id: adminId, email: "admin-users@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: adminId, enabled: false }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("disable");
  });

  test("admin can update another user's role", async () => {
    setMockUser({ id: adminId, email: "admin-users@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: targetUserId, role: "admin" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("admin can disable another user", async () => {
    setMockUser({ id: adminId, email: "admin-users@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: targetUserId, enabled: false }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/admin/users", () => {
  let deleteTargetId: string;

  beforeAll(() => {
    deleteTargetId = seedTestUser({ email: "to-delete@test.com", role: "user" });
  });

  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "user-users@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/admin/users", {
      method: "DELETE",
      body: JSON.stringify({ userId: deleteTargetId }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(403);
  });

  test("admin cannot delete themselves", async () => {
    setMockUser({ id: adminId, email: "admin-users@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/admin/users", {
      method: "DELETE",
      body: JSON.stringify({ userId: adminId }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("own account");
  });

  test("admin can delete another user", async () => {
    setMockUser({ id: adminId, email: "admin-users@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/admin/users", {
      method: "DELETE",
      body: JSON.stringify({ userId: deleteTargetId }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});
