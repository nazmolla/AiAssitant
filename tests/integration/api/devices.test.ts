/**
 * Integration tests — Devices API (/api/devices)
 *
 * Verifies device registration, listing, and revocation with a real in-memory
 * SQLite database and mocked auth layer.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";

installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/devices/route";
import { DELETE } from "@/app/api/devices/[id]/route";

let userId: string;
let otherId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "devices@example.com", role: "user" });
  otherId = seedTestUser({ email: "other-devices@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/devices", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns empty list initially", async () => {
    setMockUser({ id: userId, email: "devices@example.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });
});

describe("POST /api/devices", () => {
  test("creates a device key and returns rawKey once", async () => {
    setMockUser({ id: userId, email: "devices@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/devices", {
      method: "POST",
      body: JSON.stringify({ name: "Desk ESP32" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.rawKey).toMatch(/^nxk_[a-f0-9]{32}$/);
    expect(data.name).toBe("Desk ESP32");
    const scopes = JSON.parse(data.scopes);
    expect(scopes).toContain("device");
  });

  test("rejects empty device name", async () => {
    setMockUser({ id: userId, email: "devices@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/devices", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const req = new NextRequest("http://localhost/api/devices", {
      method: "POST",
      body: JSON.stringify({ name: "x" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("device appears in GET list after creation", async () => {
    setMockUser({ id: userId, email: "devices@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/devices", {
      method: "POST",
      body: JSON.stringify({ name: "Kitchen ESP32" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);
    const listRes = await GET();
    const list = await listRes.json();
    expect(list.some((d: { name: string }) => d.name === "Kitchen ESP32")).toBe(true);
  });
});

describe("DELETE /api/devices/:id", () => {
  let deviceId: string;

  beforeAll(async () => {
    setMockUser({ id: userId, email: "devices@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/devices", {
      method: "POST",
      body: JSON.stringify({ name: "To Delete" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    const data = await res.json();
    deviceId = data.id;
  });

  test("returns 403 when another user tries to delete", async () => {
    setMockUser({ id: otherId, email: "other-devices@example.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/devices/${deviceId}`, { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: deviceId }) });
    expect(res.status).toBe(403);
  });

  test("owner can delete device (204)", async () => {
    setMockUser({ id: userId, email: "devices@example.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/devices/${deviceId}`, { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: deviceId }) });
    expect(res.status).toBe(204);
  });

  test("returns 404 after deletion", async () => {
    setMockUser({ id: userId, email: "devices@example.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/devices/${deviceId}`, { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: deviceId }) });
    expect(res.status).toBe(404);
  });
});
