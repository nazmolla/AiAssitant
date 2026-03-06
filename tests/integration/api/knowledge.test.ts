/**
 * Integration tests — Knowledge API (/api/knowledge)
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, POST, PUT, DELETE } from "@/app/api/knowledge/route";

let userId: string;
let otherUserId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "know@example.com", role: "user" });
  otherUserId = seedTestUser({ email: "other@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/knowledge", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET(new NextRequest("http://localhost/api/knowledge"));
    expect(res.status).toBe(401);
  });

  test("returns empty list initially", async () => {
    setMockUser({ id: userId, email: "know@example.com", role: "user" });
    const res = await GET(new NextRequest("http://localhost/api/knowledge"));
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.hasMore).toBe(false);
  });
});

describe("POST /api/knowledge", () => {
  test("creates a knowledge entry", async () => {
    setMockUser({ id: userId, email: "know@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/knowledge", {
      method: "POST",
      body: JSON.stringify({
        entity: "TypeScript",
        attribute: "type",
        value: "programming language",
        source_context: "docs",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  test("returns 400 when fields are missing", async () => {
    setMockUser({ id: userId, email: "know@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/knowledge", {
      method: "POST",
      body: JSON.stringify({ entity: "partial" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("created entry appears in GET", async () => {
    setMockUser({ id: userId, email: "know@example.com", role: "user" });
    const res = await GET(new NextRequest("http://localhost/api/knowledge"));
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].entity).toBe("TypeScript");
  });

  test("entries are scoped to user", async () => {
    setMockUser({ id: otherUserId, email: "other@example.com", role: "user" });
    const res = await GET(new NextRequest("http://localhost/api/knowledge"));
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});

describe("PUT /api/knowledge", () => {
  let entryId: number;

  beforeAll(async () => {
    setMockUser({ id: userId, email: "know@example.com", role: "user" });
    const res = await GET(new NextRequest("http://localhost/api/knowledge"));
    const body = await res.json();
    entryId = body.data[0].id;
  });

  test("returns 400 without id", async () => {
    setMockUser({ id: userId, email: "know@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/knowledge", {
      method: "PUT",
      body: JSON.stringify({ value: "updated" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  test("returns 404 when another user tries to update", async () => {
    setMockUser({ id: otherUserId, email: "other@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/knowledge", {
      method: "PUT",
      body: JSON.stringify({ id: entryId, value: "hacked" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(404);
  });

  test("updates own entry", async () => {
    setMockUser({ id: userId, email: "know@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/knowledge", {
      method: "PUT",
      body: JSON.stringify({ id: entryId, value: "strongly-typed language" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/knowledge", () => {
  let entryId: number;

  beforeAll(async () => {
    setMockUser({ id: userId, email: "know@example.com", role: "user" });
    const res = await GET(new NextRequest("http://localhost/api/knowledge"));
    const body = await res.json();
    entryId = body.data[0].id;
  });

  test("returns 400 without id", async () => {
    setMockUser({ id: userId, email: "know@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/knowledge?", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  test("returns 404 when another user tries to delete", async () => {
    setMockUser({ id: otherUserId, email: "other@example.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/knowledge?id=${entryId}`, { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });

  test("deletes own entry", async () => {
    setMockUser({ id: userId, email: "know@example.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/knowledge?id=${entryId}`, { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("entry gone after deletion", async () => {
    setMockUser({ id: userId, email: "know@example.com", role: "user" });
    const res = await GET(new NextRequest("http://localhost/api/knowledge"));
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});
