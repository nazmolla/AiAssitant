/**
 * Integration tests — API Keys API (/api/config/api-keys)
 *
 * Tests the route handlers directly with a mocked auth layer
 * and a real in-memory SQLite database.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";

// Install auth mocks BEFORE importing route modules
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "@/app/api/config/api-keys/route";

let userId: string;
let adminId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "apikey@example.com", role: "user" });
  adminId = seedTestUser({ email: "admin-apikey@example.com", role: "admin" });
});
afterAll(() => teardownTestDb());

describe("GET /api/config/api-keys", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns empty list initially", async () => {
    setMockUser({ id: userId, email: "apikey@example.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });
});

describe("POST /api/config/api-keys", () => {
  test("creates a key and returns rawKey", async () => {
    setMockUser({ id: userId, email: "apikey@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "Mobile App" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.rawKey).toMatch(/^nxk_[a-f0-9]{32}$/);
    expect(data.name).toBe("Mobile App");
    expect(data.key_prefix).toBe(data.rawKey.slice(0, 8));
  });

  test("rejects empty name", async () => {
    setMockUser({ id: userId, email: "apikey@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("rejects invalid scope", async () => {
    setMockUser({ id: userId, email: "apikey@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "Bad", scopes: ["admin"] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid scope");
  });

  test("accepts custom scopes and expiry", async () => {
    setMockUser({ id: userId, email: "apikey@example.com", role: "user" });
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const req = new NextRequest("http://localhost/api/config/api-keys", {
      method: "POST",
      body: JSON.stringify({
        name: "Short-lived",
        scopes: ["chat", "threads"],
        expiresAt,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(JSON.parse(data.scopes)).toEqual(["chat", "threads"]);
    expect(data.expires_at).toBeTruthy();
  });

  test("created keys appear in GET list", async () => {
    setMockUser({ id: userId, email: "apikey@example.com", role: "user" });
    const res = await GET();
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
  });
});

describe("DELETE /api/config/api-keys", () => {
  test("deletes own key", async () => {
    setMockUser({ id: userId, email: "apikey@example.com", role: "user" });

    // Create a key to delete
    const createReq = new NextRequest("http://localhost/api/config/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "Deletable" }),
      headers: { "Content-Type": "application/json" },
    });
    const created = await (await POST(createReq)).json();

    const delReq = new NextRequest("http://localhost/api/config/api-keys", {
      method: "DELETE",
      body: JSON.stringify({ id: created.id }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await DELETE(delReq);
    expect(res.status).toBe(200);
  });

  test("cannot delete another user's key", async () => {
    // Create key as user
    setMockUser({ id: userId, email: "apikey@example.com", role: "user" });
    const createReq = new NextRequest("http://localhost/api/config/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "User Key" }),
      headers: { "Content-Type": "application/json" },
    });
    const created = await (await POST(createReq)).json();

    // Try to delete as admin (via user endpoint — should fail because key belongs to different user)
    setMockUser({ id: adminId, email: "admin-apikey@example.com", role: "admin" });
    const delReq = new NextRequest("http://localhost/api/config/api-keys", {
      method: "DELETE",
      body: JSON.stringify({ id: created.id }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await DELETE(delReq);
    expect(res.status).toBe(404);
  });
});

describe("Security — API key self-management blocked", () => {
  test("GET blocked when authenticated via API key", async () => {
    setMockUser({ id: userId, email: "apikey@example.com", role: "user", apiKeyScopes: ["chat"] });
    const res = await GET();
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("session authentication");
  });

  test("POST blocked when authenticated via API key", async () => {
    setMockUser({ id: userId, email: "apikey@example.com", role: "user", apiKeyScopes: ["chat"] });
    const req = new NextRequest("http://localhost/api/config/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "Escalation attempt" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test("DELETE blocked when authenticated via API key", async () => {
    setMockUser({ id: userId, email: "apikey@example.com", role: "user", apiKeyScopes: ["chat"] });
    const req = new NextRequest("http://localhost/api/config/api-keys", {
      method: "DELETE",
      body: JSON.stringify({ id: "some-id" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(403);
  });
});

describe("Security — key_hash never leaked", () => {
  test("POST response does not contain key_hash", async () => {
    setMockUser({ id: userId, email: "apikey@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "Hash leak check" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.key_hash).toBeUndefined();
    expect(data.rawKey).toBeDefined();
  });
});

describe("Security — name length capped", () => {
  test("name longer than 100 chars is truncated", async () => {
    setMockUser({ id: userId, email: "apikey@example.com", role: "user" });
    const longName = "A".repeat(200);
    const req = new NextRequest("http://localhost/api/config/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: longName }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name.length).toBeLessThanOrEqual(100);
  });
});
