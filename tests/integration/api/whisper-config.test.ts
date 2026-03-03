/**
 * Integration tests — Whisper Config API (/api/config/whisper)
 *
 * Tests admin-only access, GET, PUT, and POST (connectivity test).
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, PUT, POST } from "@/app/api/config/whisper/route";

let adminId: string;
let userId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "admin-whisper@example.com", role: "admin" });
  userId = seedTestUser({ email: "user-whisper@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/config/whisper", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin user", async () => {
    setMockUser({ id: userId, email: "user-whisper@example.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("returns default config for admin", async () => {
    setMockUser({ id: adminId, email: "admin-whisper@example.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.enabled).toBe(false);
    expect(data.url).toBe("");
    expect(data.model).toBe("whisper-1");
  });
});

describe("PUT /api/config/whisper", () => {
  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "user-whisper@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/whisper", {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(403);
  });

  test("saves whisper config", async () => {
    setMockUser({ id: adminId, email: "admin-whisper@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/whisper", {
      method: "PUT",
      body: JSON.stringify({
        enabled: true,
        url: "http://localhost:8083",
        model: "large-v3",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    // Verify persisted
    const getRes = await GET();
    const config = await getRes.json();
    expect(config.enabled).toBe(true);
    expect(config.url).toBe("http://localhost:8083");
    expect(config.model).toBe("large-v3");
  });

  test("rejects invalid URL", async () => {
    setMockUser({ id: adminId, email: "admin-whisper@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/whisper", {
      method: "PUT",
      body: JSON.stringify({
        url: "not-a-url",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/config/whisper (connectivity test)", () => {
  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "user-whisper@example.com", role: "user" });
    const res = await POST();
    expect(res.status).toBe(403);
  });

  test("returns error when no URL configured", async () => {
    setMockUser({ id: adminId, email: "admin-whisper@example.com", role: "admin" });

    // Clear the URL first
    const clearReq = new NextRequest("http://localhost/api/config/whisper", {
      method: "PUT",
      body: JSON.stringify({ url: "" }),
      headers: { "Content-Type": "application/json" },
    });
    await PUT(clearReq);

    const res = await POST();
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});
