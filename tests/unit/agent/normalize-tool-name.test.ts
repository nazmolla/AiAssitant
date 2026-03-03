/**
 * Unit tests — normalizeToolName
 *
 * Validates that:
 * - Tools already containing a dot are returned as-is
 * - Builtin tool names missing the "builtin." prefix are normalized
 * - Unknown tool names (no dot, not a builtin short name) are returned as-is
 * - MCP tool names (serverId.toolName) are not altered
 */
import { normalizeToolName } from "@/lib/agent/discovery";

// Mock the MCP manager so getAllBuiltinTools can be collected
jest.mock("@/lib/mcp", () => ({
  getMcpManager: () => ({
    getAllTools: () => [],
    isConnected: () => false,
  }),
}));

describe("normalizeToolName", () => {
  it("returns qualified tool names unchanged", () => {
    expect(normalizeToolName("builtin.alexa_announce")).toBe("builtin.alexa_announce");
    expect(normalizeToolName("builtin.browser_navigate")).toBe("builtin.browser_navigate");
    expect(normalizeToolName("builtin.web_search")).toBe("builtin.web_search");
  });

  it("restores builtin prefix for known short names", () => {
    expect(normalizeToolName("alexa_announce")).toBe("builtin.alexa_announce");
    expect(normalizeToolName("browser_navigate")).toBe("builtin.browser_navigate");
    expect(normalizeToolName("web_search")).toBe("builtin.web_search");
    expect(normalizeToolName("fs_read_file")).toBe("builtin.fs_read_file");
    expect(normalizeToolName("net_ping")).toBe("builtin.net_ping");
    expect(normalizeToolName("email_send")).toBe("builtin.email_send");
    expect(normalizeToolName("file_generate")).toBe("builtin.file_generate");
  });

  it("returns unknown unqualified names as-is", () => {
    expect(normalizeToolName("totally_unknown_tool")).toBe("totally_unknown_tool");
    expect(normalizeToolName("foobar")).toBe("foobar");
  });

  it("preserves MCP tool names with serverId", () => {
    const mcpName = "646228d5-d151-474e-b499-62cf92cd0c4a.HassTurnOn";
    expect(normalizeToolName(mcpName)).toBe(mcpName);
  });

  it("preserves custom tool names with prefix", () => {
    expect(normalizeToolName("custom.my_tool")).toBe("custom.my_tool");
  });
});
