/**
 * Integration tests — Custom Tools API (/api/config/custom-tools)
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, POST, PUT, DELETE } from "@/app/api/config/custom-tools/route";
import { getToolPolicy } from "@/lib/db/queries";

let adminId: string;
let userId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "admin-ct@example.com", role: "admin" });
  userId = seedTestUser({ email: "user-ct@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/config/custom-tools", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "user-ct@example.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("returns empty list for admin", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });
});

describe("POST /api/config/custom-tools", () => {
  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "user-ct@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "POST",
      body: JSON.stringify({ name: "test", description: "test", inputSchema: {}, implementation: "return {};" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test("returns 400 for missing fields", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "POST",
      body: JSON.stringify({ name: "test" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid inputSchema", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "POST",
      body: JSON.stringify({
        name: "bad_schema",
        description: "test",
        inputSchema: { type: "string" },
        implementation: "return {};",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/type.*object/i);
  });

  test("returns 400 for syntax error in implementation", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "POST",
      body: JSON.stringify({
        name: "syntax_fail",
        description: "test",
        inputSchema: { type: "object", properties: {} },
        implementation: "const x = {{;",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/syntax/i);
  });

  test("creates a tool successfully", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "POST",
      body: JSON.stringify({
        name: "api_test_tool",
        description: "An API test tool",
        inputSchema: { type: "object", properties: { x: { type: "number" } } },
        implementation: "return { doubled: args.x * 2 };",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("custom.api_test_tool");
    expect(data.description).toBe("An API test tool");
  });

  test("creating a tool auto-creates a tool policy entry", async () => {
    const policy = getToolPolicy("custom.api_test_tool");
    expect(policy).toBeDefined();
    expect(policy!.tool_name).toBe("custom.api_test_tool");
    expect(policy!.requires_approval).toBe(0);
  });

  test("returns 409 for duplicate", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "POST",
      body: JSON.stringify({
        name: "api_test_tool",
        description: "Duplicate",
        inputSchema: { type: "object", properties: {} },
        implementation: "return {};",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  test("returns 409 for semantic duplicate with different name", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "POST",
      body: JSON.stringify({
        name: "api_test_tool_v2",
        description: "An API test tool",
        inputSchema: { type: "object", properties: { x: { type: "number" } } },
        implementation: "return { doubledAgain: args.x * 2 };",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/too similar/i);
  });

  test("GET now returns the created tool", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].name).toBe("custom.api_test_tool");
  });
});

describe("PUT /api/config/custom-tools", () => {
  test("disables a tool", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "PUT",
      body: JSON.stringify({ name: "custom.api_test_tool", enabled: false }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
  });

  test("returns 404 for nonexistent tool", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "PUT",
      body: JSON.stringify({ name: "custom.no_such_tool", enabled: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(404);
  });

  test("updates tool implementation", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "PUT",
      body: JSON.stringify({
        name: "custom.api_test_tool",
        implementation: "return { tripled: args.x * 3 };",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
  });

  test("rejects invalid implementation on update", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "PUT",
      body: JSON.stringify({
        name: "custom.api_test_tool",
        implementation: "const x = {{;",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/syntax/i);
  });
});

describe("DELETE /api/config/custom-tools", () => {
  test("returns 404 for nonexistent tool", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "DELETE",
      body: JSON.stringify({ name: "custom.nope" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });

  test("deletes a tool", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/custom-tools", {
      method: "DELETE",
      body: JSON.stringify({ name: "custom.api_test_tool" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
  });

  test("deleting a tool also removes its policy entry", () => {
    const policy = getToolPolicy("custom.api_test_tool");
    expect(policy).toBeUndefined();
  });

  test("GET returns empty after delete", async () => {
    setMockUser({ id: adminId, email: "admin-ct@example.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(0);
  });
});
