/**
 * Multi-Agent Framework — Base Agent
 *
 * Abstract base class for all Nexus agents.
 * Every agent (including the orchestrator) inherits from this class.
 *
 * Responsibilities:
 * - Owns an AgentTypeDefinition (role identity, system prompt, capabilities)
 * - Provides `run(task, context)` which executes the agent via runAgentLoop
 * - The agent's instructions are injected as the opening user message to the
 *   thread, consistent with the existing PromptTool pattern
 *
 * Dependency injection:
 * - `loopRunner` param defaults to `runAgentLoop` but can be replaced in tests
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/171
 */

import type { AgentTypeDefinition, AgentRunContext, AgentRunResult } from "./types";
import type { AgentResponse } from "@/lib/agent/loop";

/** Minimal signature of runAgentLoop needed by BaseAgent. */
export type AgentLoopRunner = (
  threadId: string,
  userMessage: string,
  contentParts?: undefined,
  attachments?: undefined,
  continuation?: boolean,
  userId?: string,
) => Promise<AgentResponse>;

export abstract class BaseAgent {
  constructor(
    protected readonly definition: AgentTypeDefinition,
    protected readonly loopRunner: AgentLoopRunner | null = null,
  ) {}

  /** The agent's unique type identifier (e.g. "web_researcher"). */
  get roleId(): string {
    return this.definition.id;
  }

  /** The agent's display name (e.g. "Web Researcher"). */
  get role(): string {
    return this.definition.name;
  }

  /** Short description of this agent's capabilities. */
  get description(): string {
    return this.definition.description;
  }

  /** Semantic capability tags. */
  get capabilities(): string[] {
    return this.definition.capabilities;
  }

  /**
   * Build the full message injected as the first user message in the thread.
   * Subclasses (e.g. OrchestratorAgent) override this to include dynamic context
   * such as the current list of available agent types.
   */
  protected buildTaskMessage(task: string, additionalContext?: string): string {
    const header = `## Your role\n${this.definition.systemPrompt}`;
    const contextSection = additionalContext
      ? `\n\n## Additional context\n${additionalContext}`
      : "";
    return `${header}${contextSection}\n\n## Task\n${task}`;
  }

  /**
   * Execute the agent on the given task.
   *
   * If `context.threadId` is provided the agent appends to that thread so all
   * agents in a pipeline share the full conversation history.
   * Otherwise a new dedicated thread is created.
   */
  async run(task: string, context: AgentRunContext): Promise<AgentRunResult> {
    // Resolve loop runner lazily to avoid circular module imports at load time.
    const runner = this.loopRunner ?? (await this.resolveLoopRunner());

    const { createThread } = await import("@/lib/db");
    const threadId =
      context.threadId ??
      createThread(`[${this.role}]`, context.userId, { threadType: "scheduled" }).id;

    const message = this.buildTaskMessage(task, context.additionalContext);
    const result = await runner(threadId, message, undefined, undefined, false, context.userId);

    return {
      response: result.content ?? "",
      toolsUsed: result.toolsUsed,
      threadId,
    };
  }

  /** Lazy import of runAgentLoop — breaks circular dependency at load time. */
  private async resolveLoopRunner(): Promise<AgentLoopRunner> {
    const { runAgentLoop } = await import("@/lib/agent");
    return runAgentLoop as AgentLoopRunner;
  }
}

/**
 * Concrete non-orchestrator agent.
 *
 * Implements BaseAgent directly using the definition from AgentRegistry.
 * No additional behaviour — all logic lives in the system prompt.
 */
export class SpecializedAgent extends BaseAgent {
  constructor(definition: AgentTypeDefinition, loopRunner?: AgentLoopRunner | null) {
    super(definition, loopRunner ?? null);
  }
}
