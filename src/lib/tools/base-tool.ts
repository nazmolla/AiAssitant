/**
 * Base Tool Abstraction
 *
 * Provides the ToolCategory interface (contract for all tool categories)
 * and the BaseTool abstract class that tool modules extend.
 *
 * Tool categories self-register at module load time by calling
 * `registerToolCategory()`. The `getRegisteredToolCategories()` function
 * returns all registered categories sorted by `registrationOrder`.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/132
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
 * Abstract base class for built-in tool categories.
 *
 * Each tool module extends this class, providing:
 *  - `name` — human-readable category name
 *  - `toolNamePrefix` — prefix used by `matches()` (e.g. "builtin.web_")
 *  - `tools` — tool definitions exposed to the LLM
 *  - `toolsRequiringApproval` — tool names that need approval by default
 *  - `registrationOrder` — dispatch priority (lower = matched first)
 *  - `execute()` — dispatch tool calls by name
 *
 * Top-level categories self-register by calling `registerToolCategory()`
 * at module scope. Child tools (e.g. system tools inside WorkflowTools)
 * should NOT self-register.
 *
 * The default `matches()` implementation checks if the tool name starts
 * with `toolNamePrefix`. Override for custom matching logic.
 */
export abstract class BaseTool implements ToolCategory {
  abstract readonly name: string;
  abstract readonly toolNamePrefix: string;
  abstract readonly tools: ToolDefinition[];
  abstract readonly toolsRequiringApproval: string[];

  /**
   * Dispatch priority. Lower values are matched first during dispatch.
   * Top-level categories should override this with a specific value.
   * Child tools (not directly registered) can leave the default.
   */
  readonly registrationOrder: number = Infinity;

  /** Default matcher — checks `toolName.startsWith(toolNamePrefix)` */
  matches(toolName: string): boolean {
    return toolName.startsWith(this.toolNamePrefix);
  }

  abstract execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown>;
}

// ── Self-registration infrastructure ──────────────────────────

export class ToolCategoryRegistry {
  private static readonly toolCategoryRegistry: BaseTool[] = [];
  private static registrySorted = false;

  /**
   * Register a tool category for auto-discovery.
   * Called at module scope by each top-level tool file.
   * Duplicate registrations (same `name`) are silently ignored.
   */
  static register(tool: BaseTool): void {
    if (!ToolCategoryRegistry.toolCategoryRegistry.some((t) => t.name === tool.name)) {
      ToolCategoryRegistry.toolCategoryRegistry.push(tool);
      ToolCategoryRegistry.registrySorted = false;
    }
  }

  /**
   * Return all registered tool categories sorted by `registrationOrder`.
   * This is the auto-discovered replacement for a hardcoded array.
   */
  static getAll(): BaseTool[] {
    if (!ToolCategoryRegistry.registrySorted) {
      ToolCategoryRegistry.toolCategoryRegistry.sort((a, b) => a.registrationOrder - b.registrationOrder);
      ToolCategoryRegistry.registrySorted = true;
    }
    return ToolCategoryRegistry.toolCategoryRegistry;
  }

  /**
   * Clear the category registry. Used in tests.
   */
  static reset(): void {
    ToolCategoryRegistry.toolCategoryRegistry.length = 0;
    ToolCategoryRegistry.registrySorted = false;
  }
}

export const registerToolCategory = ToolCategoryRegistry.register.bind(ToolCategoryRegistry);
export const getRegisteredToolCategories = ToolCategoryRegistry.getAll.bind(ToolCategoryRegistry);
export const resetToolCategoryRegistry = ToolCategoryRegistry.reset.bind(ToolCategoryRegistry);
