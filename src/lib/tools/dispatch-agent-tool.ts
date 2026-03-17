/**
 * Multi-Agent Framework — Dispatch Agent Tool
 *
 * A globally registered tool that allows any agent (including the orchestrator)
 * to instantiate a specialized agent from the AgentRegistry and run it on a task.
 *
 * Tool name: builtin.dispatch_agent
 *
 * How it works:
 * - The caller passes an agentTypeId (from AgentRegistry) and a task description
 * - The tool instantiates a SpecializedAgent and runs it in the SAME thread so
 *   the orchestrator and all sub-agents share full conversation history
 * - Returns a structured result that the calling LLM can reason about
 *
 * Security notes:
 * - Only SpecializedAgent types can be dispatched — the OrchestratorAgent is NOT
 *   dispatchable via this tool, preventing infinite recursion
 * - All sub-agents run under the caller's userId, so they inherit the same
 *   tool-scope permissions
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/171
 */

import type { ToolDefinition } from "@/lib/llm";
import { BaseTool, registerToolCategory, type ToolExecutionContext } from "./base-tool";

export class DispatchAgentTool extends BaseTool {
  readonly name = "multi_agent_dispatch";
  readonly toolNamePrefix = "builtin.dispatch_agent";
  readonly registrationOrder = 20;   // register after built-in tools but before custom
  readonly toolsRequiringApproval: string[] = [];

  readonly tools: ToolDefinition[] = [
    {
      name: "builtin.dispatch_agent",
      description:
        "Dispatch a specialized agent to handle a specific sub-task. " +
        "The agent runs in the current conversation thread so subsequent agents " +
        "can see its outputs. Use this to delegate work to the most capable agent " +
        "for each part of a complex task.",
      inputSchema: {
        type: "object",
        properties: {
          agentTypeId: {
            type: "string",
            description:
              "The agent type identifier from the catalog (e.g. \"web_researcher\", \"email_manager\"). " +
              "List available types by checking the orchestrator's system prompt or calling this tool " +
              "with an invalid id to see the full list.",
          },
          task: {
            type: "string",
            description:
              "Clear, explicit sub-task description. Be specific: include all context the agent needs " +
              "to complete the task without asking follow-up questions.",
          },
          additionalContext: {
            type: "string",
            description:
              "Optional extra context, constraints, or instructions to pass to the agent " +
              "on top of its default system prompt.",
          },
        },
        required: ["agentTypeId", "task"],
      },
    },
  ];

  /** Exact match — only handle the single dispatch_agent tool name. */
  override matches(toolName: string): boolean {
    return toolName === this.toolNamePrefix;
  }

  async execute(
    _toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    const agentTypeId = String(args.agentTypeId ?? "").trim();
    const task = String(args.task ?? "").trim();
    const additionalContext = args.additionalContext
      ? String(args.additionalContext)
      : undefined;

    if (!agentTypeId) {
      throw new Error("dispatch_agent: agentTypeId is required.");
    }
    if (!task) {
      throw new Error("dispatch_agent: task is required.");
    }

    // Lazy imports break the circular dependency:
    //   tools/dispatch-agent-tool → agent/multi-agent → agent/loop → tools
    const { AgentRegistry } = await import("@/lib/agent/multi-agent/agent-registry");
    const { SpecializedAgent } = await import("@/lib/agent/multi-agent/base-agent");

    const registry = AgentRegistry.getInstance();
    const definition = registry.get(agentTypeId);

    if (!definition) {
      const available = registry
        .getAll()
        .map((d) => d.id)
        .join(", ");
      throw new Error(
        `dispatch_agent: unknown agentTypeId "${agentTypeId}". Available: ${available}`,
      );
    }

    const agent = new SpecializedAgent(definition);
    const result = await agent.run(task, {
      userId: context.userId ?? "",
      threadId: context.threadId,   // share the caller's pipeline thread
      additionalContext,
    });

    return {
      agentId: definition.id,
      agentRole: definition.name,
      task,
      response: result.response,
      toolsUsed: result.toolsUsed,
    };
  }
}

export const dispatchAgentTool = new DispatchAgentTool();

// Self-register so the tool is available in every agent loop without manual wiring.
registerToolCategory(dispatchAgentTool);
