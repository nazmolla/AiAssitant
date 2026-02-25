/**
 * Unit tests — MCP Server CRUD & user scoping
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  upsertMcpServer,
  listMcpServers,
  getMcpServer,
  deleteMcpServer,
} from "@/lib/db/queries";
import type { McpServerRecord } from "@/lib/db/queries";

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "mcp@example.com" });
});
afterAll(() => teardownTestDb());

describe("MCP Servers", () => {
  const globalServer: McpServerRecord = {
    id: "srv-global",
    name: "Global GitHub",
    transport_type: "stdio",
    command: "npx",
    args: JSON.stringify(["@modelcontextprotocol/server-github"]),
    env_vars: null,
    url: null,
    auth_type: "none",
    access_token: null,
    client_id: null,
    client_secret: null,
    user_id: null,
    scope: "global",
  };

  const userServer: McpServerRecord = {
    id: "srv-user",
    name: "My Server",
    transport_type: "sse",
    command: null,
    args: null,
    env_vars: null,
    url: "http://localhost:8080/sse",
    auth_type: "bearer",
    access_token: "token-123",
    client_id: null,
    client_secret: null,
    user_id: "", // will be set
    scope: "user",
  };

  test("upsertMcpServer creates a global server", () => {
    upsertMcpServer(globalServer);
    const srv = getMcpServer("srv-global");
    expect(srv).toBeDefined();
    expect(srv!.name).toBe("Global GitHub");
    expect(srv!.scope).toBe("global");
    expect(srv!.user_id).toBeNull();
  });

  test("upsertMcpServer creates a user-scoped server", () => {
    userServer.user_id = userId;
    upsertMcpServer(userServer);
    const srv = getMcpServer("srv-user");
    expect(srv).toBeDefined();
    expect(srv!.scope).toBe("user");
    expect(srv!.user_id).toBe(userId);
  });

  test("listMcpServers with userId returns global + user-scoped", () => {
    const servers = listMcpServers(userId);
    const names = servers.map((s) => s.name);
    expect(names).toContain("Global GitHub");
    expect(names).toContain("My Server");
  });

  test("listMcpServers without userId returns all servers", () => {
    const servers = listMcpServers();
    expect(servers.length).toBeGreaterThanOrEqual(2);
  });

  test("upsertMcpServer updates on conflict", () => {
    upsertMcpServer({ ...globalServer, name: "Updated GitHub" });
    const srv = getMcpServer("srv-global");
    expect(srv!.name).toBe("Updated GitHub");
  });

  test("deleteMcpServer removes the server", () => {
    const temp: McpServerRecord = {
      id: "srv-temp", name: "Temp", transport_type: "stdio",
      command: "echo", args: null, env_vars: null, url: null,
      auth_type: "none", access_token: null, client_id: null,
      client_secret: null, user_id: null, scope: "global",
    };
    upsertMcpServer(temp);
    deleteMcpServer("srv-temp");
    expect(getMcpServer("srv-temp")).toBeUndefined();
  });
});
