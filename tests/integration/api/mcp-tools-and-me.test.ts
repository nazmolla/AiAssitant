/**
 * Integration tests — MCP Tools API (/api/mcp/tools) and
 * Admin Users Me API (/api/admin/users/me)
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

// Mock MCP manager
jest.mock("@/lib/mcp", () => ({
  getMcpManager: jest.fn(() => ({
    getAllTools: jest.fn(() => [
      { name: "mcp_tool_1", description: "Tool one", serverId: "s1" },
      { name: "mcp_tool_2", description: "Tool two", serverId: "s2" },
    ]),
  })),
}));

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { GET as GET_TOOLS } from "@/app/api/mcp/tools/route";
import { GET as GET_ME } from "@/app/api/admin/users/me/route";

let adminId: string;
let userId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "tools-admin@test.com", role: "admin" });
  userId = seedTestUser({ email: "tools-user@test.com", role: "user" });
});
afterAll(() => teardownTestDb());

/* ------------------------------------------------------------------ */
/*  MCP Tools API                                                      */
/* ------------------------------------------------------------------ */
describe("GET /api/mcp/tools", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET_TOOLS();
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "tools-user@test.com", role: "user" });
    const res = await GET_TOOLS();
    expect(res.status).toBe(403);
  });

  test("admin sees all tools (built-in + custom + MCP)", async () => {
    setMockUser({ id: adminId, email: "tools-admin@test.com", role: "admin" });
    const res = await GET_TOOLS();
    expect(res.status).toBe(200);
    const data = await res.json();

    // Should include built-in tools + toolmaker + MCP tools
    expect(data.length).toBeGreaterThan(2); // at least built-ins + 2 MCP

    // MCP tools are present with source: "mcp"
    const mcpTools = data.filter((t: any) => t.source === "mcp");
    expect(mcpTools).toHaveLength(2);
    expect(mcpTools[0].name).toBe("mcp_tool_1");
    expect(mcpTools[1].name).toBe("mcp_tool_2");

    // Built-in tools are present with source: "builtin"
    const builtinTools = data.filter((t: any) => t.source === "builtin");
    expect(builtinTools.length).toBeGreaterThan(0);
    const builtinNames = builtinTools.map((t: any) => t.name);
    expect(builtinNames).toContain("builtin.channel_send");
    expect(builtinNames).toContain("builtin.channel_notify");
    expect(builtinNames).toContain("builtin.channel_receive");
    expect(builtinNames).toContain("builtin.file_generate");

    // Check grouping metadata
    const webTools = data.filter((t: any) => t.group === "Web Tools");
    expect(webTools.length).toBeGreaterThan(0);
    expect(webTools[0].source).toBe("builtin");

    const communicationTools = data.filter((t: any) => t.group === "Communication Channels");
    expect(communicationTools.length).toBeGreaterThan(0);

    const fileTools = data.filter((t: any) => t.group === "File Generation");
    expect(fileTools.length).toBeGreaterThan(0);

    const toolMgmt = data.filter((t: any) => t.group === "Tool Management");
    expect(toolMgmt.length).toBeGreaterThan(0);

    // Alexa Smart Home tools should be grouped
    const alexaTools = data.filter((t: any) => t.group === "Alexa Smart Home");
    expect(alexaTools.length).toBe(14);
    expect(alexaTools[0].source).toBe("builtin");
  });
});

/* ------------------------------------------------------------------ */
/*  Admin Users /me API                                                */
/* ------------------------------------------------------------------ */
describe("GET /api/admin/users/me", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET_ME();
    expect(res.status).toBe(401);
  });

  test("regular user gets their role and permissions", async () => {
    setMockUser({ id: userId, email: "tools-user@test.com", role: "user" });
    const res = await GET_ME();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.role).toBe("user");
    expect(data.permissions).toBeDefined();
    expect(data.permissions.chat).toBeDefined();
  });

  test("admin user gets admin role", async () => {
    setMockUser({ id: adminId, email: "tools-admin@test.com", role: "admin" });
    const res = await GET_ME();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.role).toBe("admin");
    expect(data.permissions).toBeDefined();
  });
});
