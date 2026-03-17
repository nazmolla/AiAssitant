/**
 * Multi-Agent Framework — Public Exports
 *
 * Import from this path to access the multi-agent orchestration system:
 *
 *   import { OrchestratorAgent, AgentRegistry } from "@/lib/agent/multi-agent";
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/171
 */

export { BaseAgent, SpecializedAgent, type AgentLoopRunner } from "./base-agent";
export { OrchestratorAgent } from "./orchestrator";
export { AgentRegistry } from "./agent-registry";
export { DEFAULT_AGENT_CATALOG } from "./agent-catalog";
export type {
  AgentTypeDefinition,
  AgentRunContext,
  AgentRunResult,
  OrchestratorRunResult,
} from "./types";
