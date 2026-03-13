/**
 * Unit tests for BaseTool abstract class and auto-discovery.
 * @see https://github.com/nazmolla/AiAssitant/issues/132
 */

import { BaseTool, type ToolExecutionContext, type ToolCategory } from "@/lib/tools/base-tool";
import { ALL_TOOL_CATEGORIES } from "@/lib/tools";

// ---------------------------------------------------------------------------
// Concrete test subclass
// ---------------------------------------------------------------------------

class TestTool extends BaseTool {
  readonly name = "test";
  readonly toolNamePrefix = "test.";
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
});

// ---------------------------------------------------------------------------
// Auto-discovery
// ---------------------------------------------------------------------------

describe("ALL_TOOL_CATEGORIES", () => {
  test("contains exactly 8 built-in categories", () => {
    expect(ALL_TOOL_CATEGORIES).toHaveLength(8);
  });

  test("all categories are BaseTool instances", () => {
    for (const cat of ALL_TOOL_CATEGORIES) {
      expect(cat).toBeInstanceOf(BaseTool);
    }
  });

  test("contains expected category names in order", () => {
    const names = ALL_TOOL_CATEGORIES.map((c) => c.name);
    expect(names).toEqual([
      "web", "browser", "fs", "network", "email", "file", "alexa", "custom",
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
});
