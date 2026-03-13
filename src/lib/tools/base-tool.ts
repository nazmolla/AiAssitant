/**
 * Base Tool Abstraction
 *
 * Provides the ToolCategory interface (contract for all tool categories)
 * and the BaseTool abstract class that tool modules extend.
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
 *  - `execute()` — dispatch tool calls by name
 *
 * The default `matches()` implementation checks if the tool name starts
 * with `toolNamePrefix`. Override for custom matching logic.
 */
export abstract class BaseTool implements ToolCategory {
  abstract readonly name: string;
  abstract readonly toolNamePrefix: string;
  abstract readonly tools: ToolDefinition[];
  abstract readonly toolsRequiringApproval: string[];

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
