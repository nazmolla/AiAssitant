/**
 * Integration tests — MCP Servers API (/api/mcp)
 *
 * Tests CRUD operations, ownership enforcement, FK constraint handling,
 * and server lifecycle.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

// Mock MCP manager so we don't connect to real servers
jest.mock("@/lib/mcp", () => ({
  getMcpManager: jest.fn(() => ({
    isConnected: jest.fn(() => false),
    disconnect: jest.fn(async () => {}),
    getAllTools: jest.fn(() => []),
  })),
}));

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "@/app/api/mcp/route";
import { upsertToolPolicy, getMcpServer } from "@/lib/db/queries";
import { v4 as uuid } from "uuid";

let adminId: string;
let userId: string;
let otherUserId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "admin-mcp@test.com", role: "admin" });
  userId = seedTestUser({ email: "user-mcp@test.com", role: "user" });
  otherUserId = seedTestUser({ email: "other-mcp@test.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/mcp", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns empty list initially", async () => {
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });
});

describe("POST /api/mcp", () => {
  test("creates a user-scoped server", async () => {
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const id = uuid();
    const req = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        id,
        name: "My Test Server",
        transport_type: "sse",
        url: "http://localhost:8080/sse",
        scope: "user",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  test("non-admin cannot create global server", async () => {
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        id: uuid(),
        name: "Global Server",
        transport_type: "sse",
        url: "http://localhost:9090/sse",
        scope: "global",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test("admin can create global server", async () => {
    setMockUser({ id: adminId, email: "admin-mcp@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        id: uuid(),
        name: "Admin Global Server",
        transport_type: "sse",
        url: "http://localhost:7070/sse",
        scope: "global",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  test("returns 400 without name", async () => {
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        id: uuid(),
        transport_type: "sse",
        url: "http://localhost:8080/sse",
        scope: "user",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 without valid UUID id", async () => {
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        id: "not-a-uuid",
        name: "Bad ID Server",
        transport_type: "sse",
        url: "http://localhost:8080/sse",
        scope: "user",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 for stdio without command", async () => {
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        id: uuid(),
        name: "Stdio No Cmd",
        transport_type: "stdio",
        scope: "user",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("secrets are redacted in GET response", async () => {
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const id = uuid();
    const createReq = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        id,
        name: "Secret Server",
        transport_type: "sse",
        url: "http://localhost:8080/sse",
        auth_type: "bearer",
        access_token: "super-secret-token-123",
        scope: "user",
      }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(createReq);

    const res = await GET();
    const data = await res.json();
    const server = data.find((s: any) => s.id === id);
    expect(server).toBeDefined();
    expect(server.access_token).toBe("••••••");
  });

  test("upsert updates name/url and preserves existing secrets", async () => {
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const id = uuid();

    // Create with a token
    const createReq = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        id,
        name: "Original Name",
        transport_type: "sse",
        url: "http://localhost:8080/sse",
        auth_type: "bearer",
        access_token: "original-secret-token",
        scope: "user",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const createRes = await POST(createReq);
    expect(createRes.status).toBe(201);

    // Update name and url, but don't send access_token (simulates edit with blank secret)
    const updateReq = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        id,
        name: "Updated Name",
        transport_type: "sse",
        url: "http://localhost:9090/sse",
        auth_type: "bearer",
        scope: "user",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const updateRes = await POST(updateReq);
    expect(updateRes.status).toBe(201);

    // Verify the name/url changed but the secret was preserved
    const server = getMcpServer(id);
    expect(server).toBeDefined();
    expect(server!.name).toBe("Updated Name");
    expect(server!.url).toBe("http://localhost:9090/sse");
    expect(server!.access_token).toBe("original-secret-token");
  });
});

describe("DELETE /api/mcp", () => {
  let serverId: string;

  beforeEach(async () => {
    serverId = uuid();
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        id: serverId,
        name: "To Delete",
        transport_type: "sse",
        url: "http://localhost:8080/sse",
        scope: "user",
      }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);
  });

  test("returns 400 without id", async () => {
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/mcp", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent server", async () => {
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/mcp?id=nonexistent`, { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });

  test("returns 403 when non-owner tries to delete", async () => {
    setMockUser({ id: otherUserId, email: "other-mcp@test.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/mcp?id=${serverId}`, { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(403);
  });

  test("owner can delete their server", async () => {
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/mcp?id=${serverId}`, { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    // Verify it's actually deleted
    expect(getMcpServer(serverId)).toBeUndefined();
  });

  test("admin can delete any server", async () => {
    setMockUser({ id: adminId, email: "admin-mcp@test.com", role: "admin" });
    const req = new NextRequest(`http://localhost/api/mcp?id=${serverId}`, { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
  });

  test("deleting server with tool policies succeeds (FK constraint handled)", async () => {
    // Create a server and attach a tool policy to it
    const srvId = uuid();
    setMockUser({ id: userId, email: "user-mcp@test.com", role: "user" });
    const createReq = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        id: srvId,
        name: "Server With Policies",
        transport_type: "sse",
        url: "http://localhost:8080/sse",
        scope: "user",
      }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(createReq);

    // Add a tool policy referencing this server
    upsertToolPolicy({
      tool_name: "test_tool_on_server",
      mcp_id: srvId,
      requires_approval: 1,
    });

    // Delete should succeed despite FK reference
    const delReq = new NextRequest(`http://localhost/api/mcp?id=${srvId}`, { method: "DELETE" });
    const res = await DELETE(delReq);
    expect(res.status).toBe(200);
    expect(getMcpServer(srvId)).toBeUndefined();
  });
});
