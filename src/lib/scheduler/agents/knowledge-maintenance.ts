/**
 * Scheduler Agent: knowledge-maintenance (issue #297)
 *
 * Deterministic replacement for system.knowledge_maintenance.run_due handler.
 * Inputs:  (none required)
 * Outputs: updated (number), skipped (number), ran (boolean)
 */

import { registerSchedulerAgent, type SchedulerAgentContext } from "../agent-registry";
import { createLogger } from "@/lib/logging/logger";

const slog = createLogger("scheduler.agents.knowledge-maintenance");

export const KNOWLEDGE_MAINTENANCE_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
  required: [],
};

export const KNOWLEDGE_MAINTENANCE_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    ran: { type: "boolean" },
    updated: { type: "number" },
    skipped: { type: "number" },
  },
  required: ["ran", "updated", "skipped"],
};

export function registerKnowledgeMaintenanceAgent(): void {
  registerSchedulerAgent({
    name: "knowledge-maintenance",
    description: "Re-index and validate the knowledge vault (embeddings, dedup, stale entry cleanup).",
    input_schema: KNOWLEDGE_MAINTENANCE_INPUT_SCHEMA,
    output_schema: KNOWLEDGE_MAINTENANCE_OUTPUT_SCHEMA,
    async fn(_inputs: Record<string, unknown>, ctx: SchedulerAgentContext): Promise<Record<string, unknown>> {
      slog.enter("knowledge-maintenance", { scheduleId: ctx.scheduleId });

      const { runKnowledgeMaintenanceIfDue } = await import("@/lib/knowledge-maintenance");
      const result = runKnowledgeMaintenanceIfDue();

      const ran = result !== null;
      const updated = (result as unknown as Record<string, unknown> | null)?.updated as number ?? 0;
      const skipped = (result as unknown as Record<string, unknown> | null)?.skipped as number ?? 0;

      slog.info("knowledge-maintenance completed", { ran, updated, skipped });
      slog.exit("knowledge-maintenance", { scheduleId: ctx.scheduleId });

      return { ran, updated, skipped };
    },
  });
}
