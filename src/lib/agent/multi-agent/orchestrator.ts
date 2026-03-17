/**
 * Multi-Agent Framework — Orchestrator Agent
 *
 * The orchestrator is a specialised BaseAgent that coordinates a team of
 * specialized agents to complete complex, multi-step tasks.
 *
 * How it works:
 * 1. Receives a high-level task description
 * 2. Runs the agent loop with an orchestrator system prompt that lists all
 *    available agent types from the AgentRegistry
 * 3. The orchestrator LLM uses the `builtin.dispatch_agent` tool to delegate
 *    sub-tasks to specialized agents
 * 4. Sub-agents run in the same pipeline thread, so the orchestrator sees
 *    their outputs and can coordinate follow-up steps
 * 5. Returns the final synthesized response and metadata
 *
 * The dispatch_agent tool is registered globally in the tool system so the
 * LLM always has access to it. When the orchestrator's system prompt makes
 * the agent aware of this tool, it naturally uses it for complex tasks.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/171
 */

import { BaseAgent, type AgentLoopRunner } from "./base-agent";
import type { AgentRegistry } from "./agent-registry";
import type { AgentRunContext, AgentRunResult, OrchestratorRunResult } from "./types";
import { buildOrchestratorSystemPrompt } from "@/lib/prompts";

/* ── Orchestrator system prompt ─────────────────────────────────── */

/* ── Orchestrator Agent ─────────────────────────────────────────── */

/** Static definition for the orchestrator itself. */
const ORCHESTRATOR_TYPE_ID = "orchestrator";

export class OrchestratorAgent extends BaseAgent {
  private readonly registry: AgentRegistry;

  constructor(registry: AgentRegistry, loopRunner?: AgentLoopRunner | null) {
    // Initial placeholder definition — prompt is rebuilt dynamically in buildTaskMessage.
    super(
      {
        id: ORCHESTRATOR_TYPE_ID,
        name: "Orchestrator",
        description: "Plans and coordinates multi-agent workflows.",
        systemPrompt: "",           // overridden by buildTaskMessage()
        capabilities: ["planning", "coordination", "delegation"],
      },
      loopRunner ?? null,
    );
    this.registry = registry;
  }

  /**
   * Override to inject both the dynamic orchestrator system prompt (which
   * includes the current agent catalog) and the task.
   */
  protected override buildTaskMessage(task: string, additionalContext?: string): string {
    const agentSummary = this.registry.buildAgentSummary();
    const systemPrompt = buildOrchestratorSystemPrompt(agentSummary);
    const contextSection = additionalContext
      ? `\n\n## Task context\n${additionalContext}`
      : "";
    return `${systemPrompt}${contextSection}\n\n## Task\n${task}`;
  }

  /**
   * Run the orchestrator on a high-level task.
   * Returns enriched result with agents-dispatched metadata.
   */
  async run(task: string, context: AgentRunContext): Promise<OrchestratorRunResult> {
    const result: AgentRunResult = await super.run(task, context);

    // Derive which agent types were dispatched by inspecting the toolsUsed list.
    // The dispatch_agent tool result JSON includes "agentId" — but from toolsUsed
    // we only have the tool name. We record that dispatch_agent was called.
    const agentsDispatched = result.toolsUsed.includes("builtin.dispatch_agent")
      ? ["builtin.dispatch_agent"]
      : [];

    return { ...result, agentsDispatched };
  }
}
