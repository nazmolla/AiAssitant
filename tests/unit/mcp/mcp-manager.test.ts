/**
 * Unit tests — MCP Manager listChanged auto-refresh
 *
 * Verifies that the MCP Manager wires up the list_changed notification
 * handler so that when an MCP server (like Forage) installs new tools
 * and emits list_changed, the connection's tool list updates automatically.
 */

// Capture the Client constructor options so we can invoke onChanged manually
let capturedOptions: any = null;
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockListTools = jest.fn().mockResolvedValue({
  tools: [
    { name: "forage_search", description: "Search tools", inputSchema: {} },
    { name: "forage_install", description: "Install tools", inputSchema: {} },
  ],
});
const mockCallTool = jest.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });

jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: jest.fn().mockImplementation((_info: any, opts: any) => {
    capturedOptions = opts;
    return {
      connect: mockConnect,
      close: mockClose,
      listTools: mockListTools,
      callTool: mockCallTool,
    };
  }),
}));

jest.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@/lib/db", () => ({
  listMcpServers: jest.fn(() => []),
  addLog: jest.fn(),
}));

import { getMcpManager } from "@/lib/mcp/manager";
import type { McpServerRecord } from "@/lib/db/queries";

const MOCK_SERVER: McpServerRecord = {
  id: "forage-001",
  name: "Forage MCP",
  transport_type: "stdio",
  command: "npx",
  args: JSON.stringify(["-y", "forage-mcp"]),
  env_vars: null,
  url: null,
  auth_type: "none",
  access_token: null,
  client_id: null,
  client_secret: null,
  user_id: null,
  scope: "global",
};

beforeEach(() => {
  capturedOptions = null;
  jest.clearAllMocks();
});

describe("MCP Manager — listChanged auto-refresh", () => {
  test("Client is created with listChanged.tools config", async () => {
    const manager = getMcpManager();
    await manager.connect(MOCK_SERVER);

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions.listChanged).toBeDefined();
    expect(capturedOptions.listChanged.tools).toBeDefined();
    expect(capturedOptions.listChanged.tools.autoRefresh).toBe(true);
    expect(typeof capturedOptions.listChanged.tools.onChanged).toBe("function");
  });

  test("initial connect discovers tools with server ID prefix", async () => {
    const manager = getMcpManager();
    const conn = await manager.connect(MOCK_SERVER);

    expect(conn.tools).toHaveLength(2);
    expect(conn.tools[0].name).toBe("forage-001.forage_search");
    expect(conn.tools[1].name).toBe("forage-001.forage_install");
  });

  test("onChanged updates connection tools when server installs new tool", async () => {
    const manager = getMcpManager();
    await manager.connect(MOCK_SERVER);

    // Simulate Forage installing a new tool — SDK calls onChanged with updated list
    const newTools = [
      { name: "forage_search", description: "Search tools", inputSchema: {} },
      { name: "forage_install", description: "Install tools", inputSchema: {} },
      { name: "foraged__postgres__query", description: "[via postgres] Query DB", inputSchema: {} },
    ];
    capturedOptions.listChanged.tools.onChanged(null, newTools);

    // The connection's tools should now include the new proxied tool
    const allTools = manager.getAllTools();
    expect(allTools).toHaveLength(3);
    const names = allTools.map((t) => t.name);
    expect(names).toContain("forage-001.foraged__postgres__query");
  });

  test("onChanged with error does not crash or update tools", async () => {
    const manager = getMcpManager();
    await manager.connect(MOCK_SERVER);

    // Simulate an error during refresh
    capturedOptions.listChanged.tools.onChanged(new Error("timeout"), null);

    // Tools should remain unchanged
    const allTools = manager.getAllTools();
    expect(allTools).toHaveLength(2);
  });

  test("onChanged with null tools does not crash or update tools", async () => {
    const manager = getMcpManager();
    await manager.connect(MOCK_SERVER);

    capturedOptions.listChanged.tools.onChanged(null, null);

    const allTools = manager.getAllTools();
    expect(allTools).toHaveLength(2);
  });

  test("getAllTools reflects live tool list after multiple refreshes", async () => {
    const manager = getMcpManager();
    await manager.connect(MOCK_SERVER);

    // First refresh: tool removed
    capturedOptions.listChanged.tools.onChanged(null, [
      { name: "forage_search", description: "Search tools", inputSchema: {} },
    ]);
    expect(manager.getAllTools()).toHaveLength(1);

    // Second refresh: tools added back
    capturedOptions.listChanged.tools.onChanged(null, [
      { name: "forage_search", description: "Search tools", inputSchema: {} },
      { name: "forage_status", description: "Status", inputSchema: {} },
      { name: "foraged__slack__send", description: "[via slack] Send message", inputSchema: {} },
    ]);
    expect(manager.getAllTools()).toHaveLength(3);
    expect(manager.getAllTools().map((t) => t.name)).toContain("forage-001.foraged__slack__send");
  });
});
