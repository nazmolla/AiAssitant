/**
 * Unit tests for BaseTool abstract class and auto-discovery.
 * @see https://github.com/nazmolla/AiAssitant/issues/132
 */

import {
  BaseTool,
  type ToolExecutionContext,
  type ToolCategory,
  registerToolCategory,
  getRegisteredToolCategories,
  resetToolCategoryRegistry,
} from "@/lib/tools/base-tool";
import { ALL_TOOL_CATEGORIES } from "@/lib/tools";

// ---------------------------------------------------------------------------
// Concrete test subclass
// ---------------------------------------------------------------------------

class TestTool extends BaseTool {
  readonly name = "test";
  readonly toolNamePrefix = "test.";
  readonly registrationOrder = 99;
  readonly tools = [{ name: "test.alpha", description: "Alpha tool", inputSchema: {} }];
  readonly toolsRequiringApproval = ["test.alpha"];

  async execute(toolName: string, args: Record<string, unknown>, _context: ToolExecutionContext) {
    return { toolName, args };
  }
}

// ---------------------------------------------------------------------------
// BaseTool
// ---------------------------------------------------------------------------

describe("BaseTool", () => {
  let tool: TestTool;

  beforeEach(() => {
    tool = new TestTool();
  });

  test("implements ToolCategory interface", () => {
    const category: ToolCategory = tool;
    expect(category.name).toBe("test");
    expect(category.tools).toHaveLength(1);
    expect(category.toolsRequiringApproval).toEqual(["test.alpha"]);
  });

  test("default matches() checks toolNamePrefix", () => {
    expect(tool.matches("test.alpha")).toBe(true);
    expect(tool.matches("test.beta")).toBe(true);
    expect(tool.matches("other.gamma")).toBe(false);
    expect(tool.matches("testing.delta")).toBe(false);
  });

  test("execute delegates to subclass implementation", async () => {
    const ctx: ToolExecutionContext = { threadId: "t-1" };
    const result = await tool.execute("test.alpha", { key: "val" }, ctx);
    expect(result).toEqual({ toolName: "test.alpha", args: { key: "val" } });
  });

  test("registrationOrder defaults to Infinity on BaseTool", () => {
    class NoOrderTool extends BaseTool {
      readonly name = "noorder";
      readonly toolNamePrefix = "noorder.";
      readonly tools = [];
      readonly toolsRequiringApproval = [];
      async execute() { return null; }
    }
    expect(new NoOrderTool().registrationOrder).toBe(Infinity);
  });

  test("registrationOrder can be set by subclass", () => {
    expect(tool.registrationOrder).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

describe("registerToolCategory / getRegisteredToolCategories", () => {
  const originalCategories = [...getRegisteredToolCategories()];

  afterEach(() => {
    // Restore original state
    resetToolCategoryRegistry();
    for (const cat of originalCategories) registerToolCategory(cat);
  });

  test("registers a tool and retrieves it", () => {
    const tool = new TestTool();
    resetToolCategoryRegistry();
    registerToolCategory(tool);
    const cats = getRegisteredToolCategories();
    expect(cats).toContain(tool);
  });

  test("prevents duplicate registration by name", () => {
    resetToolCategoryRegistry();
    const tool = new TestTool();
    registerToolCategory(tool);
    registerToolCategory(tool);
    registerToolCategory(new TestTool()); // same name
    expect(getRegisteredToolCategories().filter((t) => t.name === "test")).toHaveLength(1);
  });

  test("sorts by registrationOrder ascending", () => {
    resetToolCategoryRegistry();

    class HighPriority extends TestTool {
      override readonly name = "high";
      override readonly registrationOrder = 5;
    }
    class LowPriority extends TestTool {
      override readonly name = "low";
      override readonly registrationOrder = 100;
    }
    // Register low first, high second
    registerToolCategory(new LowPriority());
    registerToolCategory(new HighPriority());

    const names = getRegisteredToolCategories().map((t) => t.name);
    expect(names).toEqual(["high", "low"]);
  });

// ---------------------------------------------------------------------------
// Auto-discovered categories
// ---------------------------------------------------------------------------

describe("ALL_TOOL_CATEGORIES (auto-discovered)", () => {
  test("contains exactly 9 built-in categories", () => {
    expect(ALL_TOOL_CATEGORIES).toHaveLength(9);
  });

  test("all categories are BaseTool instances", () => {
    for (const cat of ALL_TOOL_CATEGORIES) {
      expect(cat).toBeInstanceOf(BaseTool);
    }
  });

  test("contains expected category names in order", () => {
    const names = ALL_TOOL_CATEGORIES.map((c) => c.name);
    expect(names).toEqual([
      "web", "browser", "fs", "multi_agent_dispatch", "network", "communication", "file", "alexa", "custom",
    ]);
  });

  test("each category has non-empty tools array", () => {
    for (const cat of ALL_TOOL_CATEGORIES) {
      expect(cat.tools.length).toBeGreaterThan(0);
    }
  });

  test("each category has a toolNamePrefix", () => {
    for (const cat of ALL_TOOL_CATEGORIES) {
      expect(cat.toolNamePrefix).toBeTruthy();
    }
  });

  test("each tool name starts with its category prefix", () => {
    for (const cat of ALL_TOOL_CATEGORIES) {
      for (const tool of cat.tools) {
        expect(tool.name.startsWith(cat.toolNamePrefix) || cat.name === "custom").toBe(true);
      }
    }
  });

  test("categories are sorted by registrationOrder ascending", () => {
    for (let i = 1; i < ALL_TOOL_CATEGORIES.length; i++) {
      expect(ALL_TOOL_CATEGORIES[i].registrationOrder)
        .toBeGreaterThanOrEqual(ALL_TOOL_CATEGORIES[i - 1].registrationOrder);
    }
  });

  test("custom tools always have the highest registrationOrder", () => {
    const customCat = ALL_TOOL_CATEGORIES.find((c) => c.name === "custom");
    const nonCustom = ALL_TOOL_CATEGORIES.filter((c) => c.name !== "custom");
    for (const cat of nonCustom) {
      expect(customCat!.registrationOrder).toBeGreaterThan(cat.registrationOrder);
    }
  });
});
});
