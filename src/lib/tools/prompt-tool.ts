/**
 * Prompt Tool Abstraction
 *
 * A reusable tool class that wraps a specific system prompt.
 * When executed, it runs the agent loop with the configured prompt,
 * allowing prompt-based tasks to be first-class tools.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/145
 */

import type { ToolDefinition } from "@/lib/llm";
import { BaseTool, type ToolExecutionContext } from "./base-tool";

export interface PromptToolConfig {
  /** Full tool name (e.g. "builtin.workflow_job_search") */
  toolName: string;
  /** Human-readable display name */
  displayName: string;
  /** Description exposed to the LLM */
  description: string;
  /** System prompt template used when this tool is executed */
  systemPrompt: string;
  /** Optional custom input schema override */
  inputSchema?: Record<string, unknown>;
}

const DEFAULT_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    threadId: {
      type: "string",
      description: "Thread ID for shared conversation context. When provided, the prompt runs in this thread so subsequent steps can see prior output.",
    },
    userId: {
      type: "string",
      description: "User ID for scoping knowledge retrieval and tool access.",
    },
    additionalContext: {
      type: "string",
      description: "Additional instructions or context to append to the system prompt.",
    },
  },
  required: ["threadId", "userId"],
};

/**
 * A tool that wraps a specific system prompt.
 *
 * When executed, it creates or reuses a conversation thread and runs
 * the agent loop with the configured prompt. The agent can use any
 * available tools (web search, browser, email, etc.) to fulfil the prompt.
 *
 * Usage:
 * ```ts
 * const tool = new PromptTool({
 *   toolName: "builtin.workflow_job_search",
 *   displayName: "Job Search",
 *   description: "Search for relevant open job listings",
 *   systemPrompt: "You are an AI job search specialist...",
 * });
 * ```
 */
export class PromptTool extends BaseTool {
  readonly name: string;
  readonly toolNamePrefix: string;
  readonly tools: ToolDefinition[];
  readonly toolsRequiringApproval: string[] = [];
  private readonly systemPrompt: string;

  constructor(config: PromptToolConfig) {
    super();
    this.name = config.displayName;
    this.toolNamePrefix = config.toolName;
    this.systemPrompt = config.systemPrompt;
    this.tools = [
      {
        name: config.toolName,
        description: config.description,
        inputSchema: config.inputSchema || DEFAULT_INPUT_SCHEMA,
      },
    ];
  }

  /** Exact match — each PromptTool handles exactly one tool name. */
  override matches(toolName: string): boolean {
    return toolName === this.toolNamePrefix;
  }

  async execute(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    const threadId = (args.threadId as string) || context.threadId;
    const userId = (args.userId as string) || context.userId || "";
    const additionalContext = (args.additionalContext as string) || "";

    if (!threadId) {
      throw new Error(`PromptTool "${this.name}" requires a threadId.`);
    }
    if (!userId) {
      throw new Error(`PromptTool "${this.name}" requires a userId.`);
    }

    const prompt = additionalContext
      ? `${this.systemPrompt}\n\nAdditional context: ${additionalContext}`
      : this.systemPrompt;

    const { runAgentLoop } = await import("@/lib/agent");
    const result = await runAgentLoop(
      threadId, prompt, undefined, undefined, undefined, userId,
    );

    return {
      response: result.content || "",
      toolsUsed: result.toolsUsed || [],
    };
  }
}
