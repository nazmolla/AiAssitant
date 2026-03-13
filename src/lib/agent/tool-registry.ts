/**
 * Tool Dispatch Registry
 *
 * Replaces 9-branch if-else dispatch chains with a single registry lookup.
 * Each tool category registers itself via the ToolCategory interface;
 * the registry routes tool calls by name using the first matching category.
 *
 * Built-in categories are auto-discovered from src/lib/tools/ via
 * ALL_TOOL_CATEGORIES.  MCP is wired as the catch-all fallback.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/114
 * @see https://github.com/nazmolla/AiAssitant/issues/132
 */

import type { ToolDefinition } from "@/lib/llm";
import { NotFoundError } from "@/lib/errors";
import { ALL_TOOL_CATEGORIES, type ToolCategory, type ToolExecutionContext } from "@/lib/tools";
import { getMcpManager } from "@/lib/mcp";

// Re-export types so existing consumers don't break
export type { ToolCategory, ToolExecutionContext };

/**
 * Central registry for all tool categories.
 *
 * Categories are checked in registration order; the first whose `matches()`
 * returns true wins.  MCP (the catch-all) should be registered last.
 */
export class ToolRegistry {
  private categories: ToolCategory[] = [];

  /** Register a tool category. Order matters — first match wins. */
  register(category: ToolCategory): void {
    this.categories.push(category);
  }

  /** Find the category that handles the given tool name, or null. */
  findCategory(toolName: string): ToolCategory | null {
    for (const cat of this.categories) {
      if (cat.matches(toolName)) return cat;
    }
    return null;
  }

  /**
   * Dispatch a tool call to the matching category.
   * Throws if no category matches (should not happen when MCP is registered as fallback).
   */
  async dispatch(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    const category = this.findCategory(toolName);
    if (!category) {
      throw new NotFoundError(`No registered tool category handles "${toolName}"`, { toolName });
    }
    return category.execute(toolName, args, context);
  }

  /** Aggregate tool definitions from all categories */
  getAllTools(): ToolDefinition[] {
    return this.categories.flatMap((c) => c.tools);
  }

  /** Aggregate tool names that require approval from all categories */
  getAllToolsRequiringApproval(): string[] {
    return this.categories.flatMap((c) => c.toolsRequiringApproval);
  }

  /** Registered category count (useful for tests) */
  get size(): number {
    return this.categories.length;
  }
}

// ---------------------------------------------------------------------------
// MCP catch-all category — anything not matched by built-in categories
// ---------------------------------------------------------------------------

const mcpCategory: ToolCategory = {
  name: "mcp",
  matches: () => true,
  execute: async (toolName, args) => getMcpManager().callTool(toolName, args),
  get tools() {
    return getMcpManager().getAllTools();
  },
  toolsRequiringApproval: [],
};

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _instance: ToolRegistry | null = null;

/** Get (or create) the global tool registry with all categories registered. */
export function getToolRegistry(): ToolRegistry {
  if (!_instance) {
    _instance = new ToolRegistry();
    // Auto-register all built-in tool categories from src/lib/tools/
    for (const category of ALL_TOOL_CATEGORIES) {
      _instance.register(category);
    }
    // MCP catch-all — always last
    _instance.register(mcpCategory);
  }
  return _instance;
}

/** Reset the singleton (for testing only) */
export function resetToolRegistry(): void {
  _instance = null;
}
