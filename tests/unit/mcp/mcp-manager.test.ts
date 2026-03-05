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

import { getMcpManager, qualifyToolName, MAX_TOOL_NAME_LENGTH } from "@/lib/mcp/manager";
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

describe("qualifyToolName — tool name length enforcement", () => {
  let reverseMap: Map<string, string>;

  beforeEach(() => {
    reverseMap = new Map();
  });

  test("MAX_TOOL_NAME_LENGTH is 64", () => {
    expect(MAX_TOOL_NAME_LENGTH).toBe(64);
  });

  test("short names pass through unchanged", () => {
    const result = qualifyToolName("srv-01", "search", reverseMap);
    expect(result).toBe("srv-01.search");
    expect(result.length).toBeLessThanOrEqual(64);
    expect(reverseMap.size).toBe(0);
  });

  test("name exactly at 64 chars passes through unchanged", () => {
    // serverId.toolName must total exactly 64
    const serverId = "a".repeat(30);
    const toolName = "t".repeat(33); // 30 + 1 (dot) + 33 = 64
    const result = qualifyToolName(serverId, toolName, reverseMap);
    expect(result).toBe(`${serverId}.${toolName}`);
    expect(result.length).toBe(64);
    expect(reverseMap.size).toBe(0);
  });

  test("name over 64 chars is truncated", () => {
    const serverId = "a".repeat(30);
    const toolName = "t".repeat(40); // 30 + 1 + 40 = 71 > 64
    const result = qualifyToolName(serverId, toolName, reverseMap);
    expect(result.length).toBe(64);
    expect(result).toBe(`${serverId}.${"t".repeat(33)}`);
    // Reverse map should have the truncated → original mapping
    expect(reverseMap.get(result)).toBe(toolName);
  });

  test("UUID server IDs (36 chars) truncate tool names over 27 chars", () => {
    const uuid = "12345678-1234-1234-1234-123456789012"; // 36 chars
    const longToolName = "foraged__postgres__query_all_tables"; // 34 chars, total = 71
    const result = qualifyToolName(uuid, longToolName, reverseMap);
    expect(result.length).toBe(64);
    // 36 + 1 = 37 prefix, leaving 27 chars for tool name
    expect(result).toBe(`${uuid}.${longToolName.substring(0, 27)}`);
    expect(reverseMap.get(result)).toBe(longToolName);
  });

  test("UUID server ID with short tool name is not truncated", () => {
    const uuid = "12345678-1234-1234-1234-123456789012";
    const shortToolName = "search"; // 36 + 1 + 6 = 43 < 64
    const result = qualifyToolName(uuid, shortToolName, reverseMap);
    expect(result).toBe(`${uuid}.${shortToolName}`);
    expect(result.length).toBe(43);
    expect(reverseMap.size).toBe(0);
  });

  test("extremely long server ID falls back to full truncation", () => {
    const serverId = "x".repeat(70); // way over 64
    const toolName = "search";
    const result = qualifyToolName(serverId, toolName, reverseMap);
    expect(result.length).toBe(64);
    expect(reverseMap.get(result)).toBe(toolName);
  });

  test("multiple tools on same server with distinct truncated names", () => {
    const uuid = "12345678-1234-1234-1234-123456789012";
    const tool1 = "a".repeat(30);
    const tool2 = "b".repeat(30);
    const r1 = qualifyToolName(uuid, tool1, reverseMap);
    const r2 = qualifyToolName(uuid, tool2, reverseMap);
    expect(r1.length).toBe(64);
    expect(r2.length).toBe(64);
    expect(r1).not.toBe(r2);
    expect(reverseMap.get(r1)).toBe(tool1);
    expect(reverseMap.get(r2)).toBe(tool2);
  });
});

describe("MCP Manager — callTool with truncated tool names", () => {
  const UUID_SERVER: McpServerRecord = {
    id: "12345678-1234-1234-1234-123456789012",
    name: "Test Server",
    transport_type: "stdio",
    command: "node",
    args: JSON.stringify(["server.js"]),
    env_vars: null,
    url: null,
    auth_type: "none",
    access_token: null,
    client_id: null,
    client_secret: null,
    user_id: null,
    scope: "global",
  };

  beforeEach(async () => {
    // Clean slate: disconnect all servers from singleton
    await getMcpManager().disconnectAll();
  });

  test("callTool resolves truncated name back to original for MCP call", async () => {
    const longToolName = "foraged__postgres__query_all_tables"; // 34 chars → truncated
    mockListTools.mockResolvedValueOnce({
      tools: [{ name: longToolName, description: "Query", inputSchema: {} }],
    });

    const manager = getMcpManager();
    await manager.connect(UUID_SERVER);

    // The tool name in getAllTools should be truncated
    const tools = manager.getAllTools();
    expect(tools[0].name.length).toBeLessThanOrEqual(64);

    // Call the tool using the truncated qualified name
    mockCallTool.mockResolvedValueOnce({ content: [{ type: "text", text: "result" }] });
    await manager.callTool(tools[0].name, { query: "SELECT 1" });

    // Verify that callTool sent the ORIGINAL tool name to the MCP server
    expect(mockCallTool).toHaveBeenCalledWith({
      name: longToolName,
      arguments: { query: "SELECT 1" },
    });
  });

  test("callTool works normally with non-truncated tool names", async () => {
    mockListTools.mockResolvedValueOnce({
      tools: [{ name: "search", description: "Search", inputSchema: {} }],
    });

    const manager = getMcpManager();
    await manager.connect(UUID_SERVER);

    mockCallTool.mockResolvedValueOnce({ content: [{ type: "text", text: "ok" }] });
    await manager.callTool(`${UUID_SERVER.id}.search`, { q: "test" });

    expect(mockCallTool).toHaveBeenCalledWith({
      name: "search",
      arguments: { q: "test" },
    });
  });

  test("callTool throws for invalid tool name format", async () => {
    const manager = getMcpManager();
    await expect(manager.callTool("no-dot-here", {})).rejects.toThrow(
      'Invalid tool name format: "no-dot-here"'
    );
  });

  test("all qualified tool names from connect are within 64 chars", async () => {
    mockListTools.mockResolvedValueOnce({
      tools: [
        { name: "short", description: "", inputSchema: {} },
        { name: "foraged__postgres__query_all_tables_extended", description: "", inputSchema: {} },
        { name: "a".repeat(100), description: "", inputSchema: {} },
      ],
    });

    const manager = getMcpManager();
    await manager.connect(UUID_SERVER);

    const allTools = manager.getAllTools();
    for (const tool of allTools) {
      expect(tool.name.length).toBeLessThanOrEqual(64);
    }
  });
});
