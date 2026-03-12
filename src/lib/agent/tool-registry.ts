/**
 * Tool Dispatch Registry
 *
 * Replaces 9-branch if-else dispatch chains with a single registry lookup.
 * Each tool category registers itself via the ToolCategory interface;
 * the registry routes tool calls by name using the first matching category.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/114
 */

import type { ToolDefinition } from "@/lib/llm";

/** Context passed to tool executors that need thread/user info */
export interface ToolExecutionContext {
  threadId: string;
  userId?: string;
}

/** Common interface every tool category must implement */
export interface ToolCategory {
  /** Human-readable category name (e.g. "web", "browser", "fs") */
  readonly name: string;
  /** Return true if this category handles the given tool name */
  matches(toolName: string): boolean;
  /** Execute the tool and return the result */
  execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown>;
  /** Tool definitions exposed to the LLM */
  readonly tools: ToolDefinition[];
  /** Names of tools that require approval by default */
  readonly toolsRequiringApproval: string[];
}

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
      throw new Error(`No registered tool category handles "${toolName}"`);
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
// Category adapters — thin wrappers that conform each tool module to the
// ToolCategory interface.  Imported lazily via createToolRegistry() below.
// ---------------------------------------------------------------------------

import { BUILTIN_WEB_TOOLS, isBuiltinWebTool, executeBuiltinWebTool } from "./web-tools";
import { BUILTIN_BROWSER_TOOLS, isBrowserTool, executeBrowserTool, BROWSER_TOOLS_REQUIRING_APPROVAL } from "./browser-tools";
import { BUILTIN_FS_TOOLS, isFsTool, executeBuiltinFsTool, FS_TOOLS_REQUIRING_APPROVAL } from "./fs-tools";
import { BUILTIN_NETWORK_TOOLS, isNetworkTool, executeBuiltinNetworkTool, NETWORK_TOOLS_REQUIRING_APPROVAL } from "./network-tools";
import { BUILTIN_EMAIL_TOOLS, isEmailTool, executeBuiltinEmailTool, EMAIL_TOOLS_REQUIRING_APPROVAL } from "./email-tools";
import { BUILTIN_FILE_TOOLS, isFileTool, executeBuiltinFileTool, FILE_TOOLS_REQUIRING_APPROVAL } from "./file-tools";
import { isCustomTool, executeCustomTool, getCustomToolDefinitions, CUSTOM_TOOLS_REQUIRING_APPROVAL, BUILTIN_TOOLMAKER_TOOLS } from "./custom-tools";
import { BUILTIN_ALEXA_TOOLS, isAlexaTool, executeAlexaTool, ALEXA_TOOLS_REQUIRING_APPROVAL } from "./alexa-tools";
import { getMcpManager } from "@/lib/mcp";
import { getThread } from "@/lib/db";

const webCategory: ToolCategory = {
  name: "web",
  matches: isBuiltinWebTool,
  execute: async (_name, args) => executeBuiltinWebTool(_name, args),
  tools: BUILTIN_WEB_TOOLS,
  toolsRequiringApproval: [],
};

const browserCategory: ToolCategory = {
  name: "browser",
  matches: isBrowserTool,
  execute: async (_name, args) => executeBrowserTool(_name, args),
  tools: BUILTIN_BROWSER_TOOLS,
  toolsRequiringApproval: [...BROWSER_TOOLS_REQUIRING_APPROVAL],
};

const fsCategory: ToolCategory = {
  name: "fs",
  matches: isFsTool,
  execute: async (_name, args) => executeBuiltinFsTool(_name, args),
  tools: BUILTIN_FS_TOOLS,
  toolsRequiringApproval: [...FS_TOOLS_REQUIRING_APPROVAL],
};

const networkCategory: ToolCategory = {
  name: "network",
  matches: isNetworkTool,
  execute: async (_name, args) => executeBuiltinNetworkTool(_name, args),
  tools: BUILTIN_NETWORK_TOOLS,
  toolsRequiringApproval: [...NETWORK_TOOLS_REQUIRING_APPROVAL],
};

const emailCategory: ToolCategory = {
  name: "email",
  matches: isEmailTool,
  execute: async (toolName, args, context) => {
    const thread = getThread(context.threadId);
    return executeBuiltinEmailTool(toolName, args, thread?.user_id ?? undefined, context.threadId);
  },
  tools: BUILTIN_EMAIL_TOOLS,
  toolsRequiringApproval: [...EMAIL_TOOLS_REQUIRING_APPROVAL],
};

const fileCategory: ToolCategory = {
  name: "file",
  matches: isFileTool,
  execute: async (toolName, args, context) =>
    executeBuiltinFileTool(toolName, args, { threadId: context.threadId }),
  tools: BUILTIN_FILE_TOOLS,
  toolsRequiringApproval: [...FILE_TOOLS_REQUIRING_APPROVAL],
};

const alexaCategory: ToolCategory = {
  name: "alexa",
  matches: isAlexaTool,
  execute: async (_name, args) => executeAlexaTool(_name, args),
  tools: BUILTIN_ALEXA_TOOLS,
  toolsRequiringApproval: [...ALEXA_TOOLS_REQUIRING_APPROVAL],
};

const customCategory: ToolCategory = {
  name: "custom",
  matches: isCustomTool,
  execute: async (toolName, args) => executeCustomTool(toolName, args),
  get tools() {
    return [...BUILTIN_TOOLMAKER_TOOLS, ...getCustomToolDefinitions()];
  },
  toolsRequiringApproval: [...CUSTOM_TOOLS_REQUIRING_APPROVAL],
};

const mcpCategory: ToolCategory = {
  name: "mcp",
  // MCP is the catch-all — anything not matched above is routed here
  matches: () => true,
  execute: async (toolName, args) => getMcpManager().callTool(toolName, args),
  get tools() {
    return getMcpManager().getTools();
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
    // Order matters: specific categories first, MCP catch-all last.
    _instance.register(webCategory);
    _instance.register(browserCategory);
    _instance.register(fsCategory);
    _instance.register(networkCategory);
    _instance.register(emailCategory);
    _instance.register(fileCategory);
    _instance.register(alexaCategory);
    _instance.register(customCategory);
    _instance.register(mcpCategory);
  }
  return _instance;
}

/** Reset the singleton (for testing only) */
export function resetToolRegistry(): void {
  _instance = null;
}
