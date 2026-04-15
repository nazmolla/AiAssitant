/**
 * Scheduler Agent Registry (issue #297)
 *
 * Maps agent_name → a typed, deterministic function with declared input/output schemas.
 * Each registered agent:
 *   - Declares input_schema (JSONSchema) — validated before call
 *   - Declares output_schema (JSONSchema) — validated after call by the engine
 *   - Produces only the declared output keys; nothing else stored
 *
 * Usage:
 *   const entry = getSchedulerAgent("email-ingest");
 *   const output = await entry.fn(inputs, ctx);
 */

export interface SchedulerAgentContext {
  scheduleId: string;
  runId: string;
  taskRunId: string;
  agentName: string;
}

export type SchedulerAgentFn = (
  inputs: Record<string, unknown>,
  ctx: SchedulerAgentContext,
) => Promise<Record<string, unknown>>;

export interface SchedulerAgentDefinition {
  name: string;
  description: string;
  /** JSONSchema object describing expected inputs. */
  input_schema: Record<string, unknown>;
  /** JSONSchema object describing required outputs (engine validates after call). */
  output_schema: Record<string, unknown>;
  fn: SchedulerAgentFn;
}

const registry = new Map<string, SchedulerAgentDefinition>();

export function registerSchedulerAgent(def: SchedulerAgentDefinition): void {
  registry.set(def.name, def);
}

export function getSchedulerAgent(name: string): SchedulerAgentDefinition | undefined {
  return registry.get(name);
}

export function getAllSchedulerAgents(): SchedulerAgentDefinition[] {
  return Array.from(registry.values());
}

/** Validate a plain object against a simple JSONSchema (type:object, properties, required). */
export function validateAgentSchema(
  schema: Record<string, unknown>,
  data: Record<string, unknown>,
): { valid: boolean; missing: string[] } {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const missing = required.filter((key) => !(key in data) || data[key] === undefined || data[key] === null);
  return { valid: missing.length === 0, missing };
}

// ── Auto-register built-in agents on module load ──────────────────

import { registerEmailIngestAgent } from "./agents/email-ingest";
import { registerKnowledgeMaintenanceAgent } from "./agents/knowledge-maintenance";
import { registerDbMaintenanceAgent } from "./agents/db-maintenance";
import { registerProactiveScanAgent } from "./agents/proactive-scan";

registerEmailIngestAgent();
registerKnowledgeMaintenanceAgent();
registerDbMaintenanceAgent();
registerProactiveScanAgent();
