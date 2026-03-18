/**
 * Unit tests for the ToolRegistry and ToolCategory interface.
 * @see https://github.com/nazmolla/AiAssitant/issues/114
 */

import {
  ToolRegistry,
  getToolRegistry,
  resetToolRegistry,
  type ToolCategory,
  type ToolExecutionContext,
} from "@/lib/agent/tool-registry";

// ---------------------------------------------------------------------------
// Minimal stub categories for isolated testing
// ---------------------------------------------------------------------------

function makeCategory(
  name: string,
  prefix: string,
  overrides: Partial<ToolCategory> = {}
): ToolCategory {
  return {
    name,
    matches: (n) => n.startsWith(prefix),
    execute: jest.fn(async () => `${name}-result`),
    tools: [{ name: `${prefix}tool1`, description: `${name} tool`, inputSchema: {} }],
    toolsRequiringApproval: [],
    ...overrides,
  };
}

const ctx: ToolExecutionContext = { threadId: "t-1" };

// ---------------------------------------------------------------------------
// ToolRegistry class
// ---------------------------------------------------------------------------

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  test("starts with zero categories", () => {
    expect(registry.size).toBe(0);
  });

  test("register increases size", () => {
    registry.register(makeCategory("a", "a."));
    registry.register(makeCategory("b", "b."));
    expect(registry.size).toBe(2);
  });

  test("findCategory returns first matching category", () => {
    const catA = makeCategory("a", "a.");
    const catB = makeCategory("b", "b.");
    registry.register(catA);
    registry.register(catB);

    expect(registry.findCategory("a.foo")).toBe(catA);
    expect(registry.findCategory("b.bar")).toBe(catB);
  });

  test("findCategory returns null when nothing matches", () => {
    registry.register(makeCategory("a", "a."));
    expect(registry.findCategory("z.unknown")).toBeNull();
  });

  test("dispatch routes to the correct category executor", async () => {
    const catA = makeCategory("a", "a.");
    const catB = makeCategory("b", "b.");
    registry.register(catA);
    registry.register(catB);

    const result = await registry.dispatch("b.tool", { key: "val" }, ctx);

    expect(result).toBe("b-result");
    expect(catB.execute).toHaveBeenCalledWith("b.tool", { key: "val" }, ctx);
    expect(catA.execute).not.toHaveBeenCalled();
  });

  test("dispatch throws when no category matches", async () => {
    registry.register(makeCategory("a", "a."));
    await expect(registry.dispatch("z.nope", {}, ctx)).rejects.toThrow(
      'No registered tool category handles "z.nope"'
    );
  });

  test("first-match wins when multiple categories could match", async () => {
    const specific = makeCategory("specific", "builtin.");
    const catchAll = makeCategory("catchall", "", { matches: () => true });
    registry.register(specific);
    registry.register(catchAll);

    const result = await registry.dispatch("builtin.web_search", {}, ctx);
    expect(result).toBe("specific-result");
    expect(specific.execute).toHaveBeenCalled();
    expect(catchAll.execute).not.toHaveBeenCalled();
  });

  test("getAllTools aggregates definitions from all categories", () => {
    registry.register(makeCategory("a", "a."));
    registry.register(
      makeCategory("b", "b.", {
        tools: [
          { name: "b.t1", description: "b1", inputSchema: {} },
          { name: "b.t2", description: "b2", inputSchema: {} },
        ],
      })
    );

    const tools = registry.getAllTools();
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(["a.tool1", "b.t1", "b.t2"]);
  });

  test("getAllToolsRequiringApproval aggregates from all categories", () => {
    registry.register(
      makeCategory("a", "a.", { toolsRequiringApproval: ["a.dangerous"] })
    );
    registry.register(
      makeCategory("b", "b.", { toolsRequiringApproval: ["b.risky", "b.scary"] })
    );

    const requiring = registry.getAllToolsRequiringApproval();
    expect(requiring).toEqual(["a.dangerous", "b.risky", "b.scary"]);
  });
});

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

describe("getToolRegistry (singleton)", () => {
  afterEach(() => {
    resetToolRegistry();
  });

  test("returns the same instance on repeated calls", () => {
    const a = getToolRegistry();
    const b = getToolRegistry();
    expect(a).toBe(b);
  });

  test("registers all 9 built-in categories and custom", () => {
    const registry = getToolRegistry();
    // 9 built-in categories (web, browser, fs, multi_agent_dispatch, network, communication, file, alexa, custom) + 1 MCP = 10
    expect(registry.size).toBe(10);
  });

  test("finds category for each builtin tool type", () => {
    const registry = getToolRegistry();
    expect(registry.findCategory("builtin.web_search")?.name).toBe("web");
    expect(registry.findCategory("builtin.browser_navigate")?.name).toBe("browser");
    expect(registry.findCategory("builtin.fs_read_file")?.name).toBe("fs");
    expect(registry.findCategory("builtin.net_ping")?.name).toBe("network");
    expect(registry.findCategory("builtin.channel_send")?.name).toBe("communication");
    expect(registry.findCategory("builtin.file_generate")?.name).toBe("file");
    expect(registry.findCategory("builtin.alexa_announce")?.name).toBe("alexa");
  });

  test("custom tools match the custom category", () => {
    const registry = getToolRegistry();
    expect(registry.findCategory("custom.my_tool")?.name).toBe("custom");
  });

  test("unknown tools fall through to MCP catch-all", () => {
    const registry = getToolRegistry();
    expect(registry.findCategory("mcp__some_server__some_tool")?.name).toBe("mcp");
    expect(registry.findCategory("completely_unknown_tool")?.name).toBe("mcp");
  });

  test("resetToolRegistry creates a fresh instance", () => {
    const a = getToolRegistry();
    resetToolRegistry();
    const b = getToolRegistry();
    expect(a).not.toBe(b);
  });
});
