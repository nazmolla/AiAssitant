/**
 * Integration tests — Kraken integration config API
 * (/api/config/integrations/kraken)
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";

installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, PUT, DELETE } from "@/app/api/config/integrations/kraken/route";

let userId: string;
let otherUserId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "kraken@example.com", role: "user" });
  otherUserId = seedTestUser({ email: "other@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

function makePut(body: unknown) {
  return new NextRequest("http://localhost/api/config/integrations/kraken", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("GET /api/config/integrations/kraken", () => {
  test("401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns hasCredentials: false when no credentials saved", async () => {
    setMockUser({ id: userId, email: "kraken@example.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ hasCredentials: false, apiKeyPrefix: null, updatedAt: null });
  });
});

describe("PUT /api/config/integrations/kraken", () => {
  test("401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await PUT(makePut({ apiKey: "key", apiSecret: "secret" }));
    expect(res.status).toBe(401);
  });

  test("400 when apiKey is missing", async () => {
    setMockUser({ id: userId, email: "kraken@example.com", role: "user" });
    const res = await PUT(makePut({ apiSecret: "secret" }));
    expect(res.status).toBe(400);
  });

  test("400 when apiSecret is missing", async () => {
    setMockUser({ id: userId, email: "kraken@example.com", role: "user" });
    const res = await PUT(makePut({ apiKey: "key" }));
    expect(res.status).toBe(400);
  });

  test("saves credentials and returns ok", async () => {
    setMockUser({ id: userId, email: "kraken@example.com", role: "user" });
    const res = await PUT(makePut({ apiKey: "myapikey12345678", apiSecret: "mysecret" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("GET after PUT returns hasCredentials: true with prefix", async () => {
    setMockUser({ id: userId, email: "kraken@example.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasCredentials).toBe(true);
    expect(data.apiKeyPrefix).toBe("myapikey");
    expect(data.apiKeyPrefix).toHaveLength(8);
    expect(data.updatedAt).toBeTruthy();
  });

  test("does not expose api_secret in GET response", async () => {
    setMockUser({ id: userId, email: "kraken@example.com", role: "user" });
    const res = await GET();
    const data = await res.json();
    expect(JSON.stringify(data)).not.toContain("mysecret");
  });

  test("other user sees their own (empty) credentials", async () => {
    setMockUser({ id: otherUserId, email: "other@example.com", role: "user" });
    const res = await GET();
    const data = await res.json();
    expect(data.hasCredentials).toBe(false);
  });
});

describe("DELETE /api/config/integrations/kraken", () => {
  test("401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  test("removes credentials", async () => {
    setMockUser({ id: userId, email: "kraken@example.com", role: "user" });
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test("GET after DELETE returns hasCredentials: false", async () => {
    setMockUser({ id: userId, email: "kraken@example.com", role: "user" });
    const res = await GET();
    const data = await res.json();
    expect(data.hasCredentials).toBe(false);
  });
});
