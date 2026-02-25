/**
 * Integration tests — Auth Config API (/api/config/auth)
 *
 * Tests admin-only auth provider management: listing, creation,
 * updates, deletion, and per-type validation.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, POST, PATCH, DELETE } from "@/app/api/config/auth/route";

let adminId: string;
let userId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "auth-admin@test.com", role: "admin" });
  userId = seedTestUser({ email: "auth-user@test.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/config/auth", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "auth-user@test.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("admin sees empty list initially", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("POST /api/config/auth", () => {
  test("returns 400 without label", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/auth", {
      method: "POST",
      body: JSON.stringify({ provider_type: "google", client_id: "cid", client_secret: "cs" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid provider_type", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/auth", {
      method: "POST",
      body: JSON.stringify({ label: "Test", provider_type: "github" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("provider_type");
  });

  test("returns 400 when Azure AD missing tenant_id", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/auth", {
      method: "POST",
      body: JSON.stringify({ label: "Azure", provider_type: "azure-ad", client_id: "cid", client_secret: "cs" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("tenant_id");
  });

  test("returns 400 when Discord missing bot_token", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/auth", {
      method: "POST",
      body: JSON.stringify({ label: "Discord", provider_type: "discord", application_id: "aid" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("bot_token");
  });

  test("creates Google provider", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/auth", {
      method: "POST",
      body: JSON.stringify({
        label: "Google SSO",
        provider_type: "google",
        client_id: "google-client-id",
        client_secret: "google-secret-value",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.label).toBe("Google SSO");
    expect(data.client_id).toBe("google-client-id");
    // Secret should NOT be returned verbatim
    expect(data.has_client_secret).toBe(true);
    expect(data.client_secret).toBeUndefined();
  });

  test("GET lists created provider with secrets stripped", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const res = await GET();
    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);
    const google = data.find((p: any) => p.label === "Google SSO");
    expect(google).toBeDefined();
    expect(google.has_client_secret).toBe(true);
    expect(google.client_secret).toBeUndefined();
  });
});

describe("PATCH /api/config/auth", () => {
  let providerId: string;

  beforeAll(async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const res = await GET();
    const data = await res.json();
    providerId = data.find((p: any) => p.label === "Google SSO")?.id;
  });

  test("returns 400 without id", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/auth", {
      method: "PATCH",
      body: JSON.stringify({ label: "Updated" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent provider", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/auth", {
      method: "PATCH",
      body: JSON.stringify({ id: "nonexistent-id", label: "Updated" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(404);
  });

  test("updates provider label", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/auth", {
      method: "PATCH",
      body: JSON.stringify({ id: providerId, label: "Google Updated" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.label).toBe("Google Updated");
  });
});

describe("DELETE /api/config/auth", () => {
  test("returns 400 without id", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/auth", {
      method: "DELETE",
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent provider", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/auth?id=nonexistent", {
      method: "DELETE",
    });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });

  test("deletes existing provider", async () => {
    setMockUser({ id: adminId, email: "auth-admin@test.com", role: "admin" });

    // Create one to delete
    const createReq = new NextRequest("http://localhost/api/config/auth", {
      method: "POST",
      body: JSON.stringify({
        label: "To Delete",
        provider_type: "google",
        client_id: "del-cid",
        client_secret: "del-cs",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const createRes = await POST(createReq);
    const created = await createRes.json();

    const req = new NextRequest(`http://localhost/api/config/auth?id=${created.id}`, {
      method: "DELETE",
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});
