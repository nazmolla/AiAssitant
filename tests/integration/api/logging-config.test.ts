/**
 * Integration tests — Logging Config API (/api/config/logging)
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/config/logging/route";

let adminId: string;
let userId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "logging-admin@example.com", role: "admin" });
  userId = seedTestUser({ email: "logging-user@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("/api/config/logging", () => {
  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "logging-user@example.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("returns current minimum level for admin", async () => {
    setMockUser({ id: adminId, email: "logging-admin@example.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(["verbose", "thought", "warning", "error", "critical"]).toContain(data.min_level);
  });

  test("updates minimum level for admin", async () => {
    setMockUser({ id: adminId, email: "logging-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/logging", {
      method: "PUT",
      body: JSON.stringify({ min_level: "error" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.min_level).toBe("error");
  });

  test("rejects invalid minimum level", async () => {
    setMockUser({ id: adminId, email: "logging-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/logging", {
      method: "PUT",
      body: JSON.stringify({ min_level: "info" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });
});
