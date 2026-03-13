import type { ToolDefinition } from "@/lib/llm";
import { buildCappedToolList, MAX_TOOLS_PER_REQUEST } from "@/lib/tools/tool-cap";

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: { type: "object", properties: {} },
  };
}

describe("buildCappedToolList", () => {
  it("fills remaining slots with MCP tools when builtin/custom are under cap", () => {
    const builtin = [makeTool("builtin.a"), makeTool("builtin.b")];
    const custom = [makeTool("custom.a")];
    const mcp = [makeTool("mcp.a"), makeTool("mcp.b"), makeTool("mcp.c")];

    const tools = buildCappedToolList(builtin, custom, mcp, 5);

    expect(tools.map((t) => t.name)).toEqual(["builtin.a", "builtin.b", "custom.a", "mcp.a", "mcp.b"]);
  });

  it("hard-caps total tools when builtin/custom exceed cap", () => {
    const builtin = Array.from({ length: 80 }, (_, i) => makeTool(`builtin.${i}`));
    const custom = Array.from({ length: 80 }, (_, i) => makeTool(`custom.${i}`));
    const mcp = Array.from({ length: 20 }, (_, i) => makeTool(`mcp.${i}`));

    const tools = buildCappedToolList(builtin, custom, mcp, MAX_TOOLS_PER_REQUEST);

    expect(tools).toHaveLength(MAX_TOOLS_PER_REQUEST);
    expect(tools.some((t) => t.name.startsWith("mcp."))).toBe(false);
  });

  it("preserves priority order as builtin then custom then MCP", () => {
    const builtin = [makeTool("builtin.first")];
    const custom = [makeTool("custom.first")];
    const mcp = [makeTool("mcp.first")];

    const tools = buildCappedToolList(builtin, custom, mcp, 3);

    expect(tools.map((t) => t.name)).toEqual(["builtin.first", "custom.first", "mcp.first"]);
  });
});
