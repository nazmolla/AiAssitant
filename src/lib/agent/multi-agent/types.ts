/**
 * Multi-Agent Framework — Shared Types
 *
 * Core data contracts for the Nexus multi-agent orchestration framework.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/171
 */

/** Definition of a specialized agent type stored in the agent catalog. */
export interface AgentTypeDefinition {
  /** Unique identifier, e.g. "web_researcher". Used as the agentTypeId in dispatch_agent calls. */
  id: string;
  /** Human-readable role name, e.g. "Web Researcher". */
  name: string;
  /** Short description of what the agent can do — used by the orchestrator for selection. */
  description: string;
  /** Full system-prompt-style instructions governing the agent's behaviour and focus. */
  systemPrompt: string;
  /** Semantic capability tags, e.g. ["research", "web_search", "summarization"]. */
  capabilities: string[];
}

/** Runtime context passed to every agent's `run()` call. */
export interface AgentRunContext {
  /** ID of the user on whose behalf the agent runs. Required for tool scope checks. */
  userId: string;
  /**
   * Optional existing thread to reuse. When supplied the agent appends to the thread
   * so subsequent agents in the same pipeline share the full conversation history.
   * When omitted a new thread is created.
   */
  threadId?: string;
  /** Optional free-text appended to the role prompt before the task. */
  additionalContext?: string;
  /**
   * Optional cap on agent loop iterations. Overrides the global MAX_TOOL_ITERATIONS
   * constant when set. Useful for scheduled tasks where the operator wants to limit
   * how deeply the agent explores before returning.
   */
  maxIterations?: number;
}

/** Structured result returned from every agent `run()` call. */
export interface AgentRunResult {
  /** Final textual response produced by the agent. */
  response: string;
  /** Names of every tool called during the agent's execution. */
  toolsUsed: string[];
  /** The thread ID in which this agent ran (created or reused). */
  threadId: string;
}

/** Result returned by `OrchestratorAgent.run()` with extra orchestration metadata. */
export interface OrchestratorRunResult extends AgentRunResult {
  /** IDs of agent types that were dispatched during this orchestration run. */
  agentsDispatched: string[];
}
