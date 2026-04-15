/**
 * Scheduler Agent: db-maintenance (issue #297)
 *
 * Deterministic replacement for system.db_maintenance.run_due handler.
 * Inputs:  (none required)
 * Outputs: ran (boolean), vacuumed (boolean), pruned (number)
 */

import { registerSchedulerAgent, type SchedulerAgentContext } from "../agent-registry";
import { createLogger } from "@/lib/logging/logger";

const slog = createLogger("scheduler.agents.db-maintenance");

export const DB_MAINTENANCE_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
  required: [],
};

export const DB_MAINTENANCE_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    ran: { type: "boolean" },
    vacuumed: { type: "boolean" },
    pruned: { type: "number" },
  },
  required: ["ran", "vacuumed", "pruned"],
};

export function registerDbMaintenanceAgent(): void {
  registerSchedulerAgent({
    name: "db-maintenance",
    description: "Run database maintenance: WAL checkpoint, log pruning, VACUUM if due.",
    input_schema: DB_MAINTENANCE_INPUT_SCHEMA,
    output_schema: DB_MAINTENANCE_OUTPUT_SCHEMA,
    async fn(_inputs: Record<string, unknown>, ctx: SchedulerAgentContext): Promise<Record<string, unknown>> {
      slog.enter("db-maintenance", { scheduleId: ctx.scheduleId });

      const { runDbMaintenanceIfDue } = await import("@/lib/db");
      const result = runDbMaintenanceIfDue();

      const ran = result !== null;
      const vacuumed = (result as Record<string, unknown> | null)?.vacuumed as boolean ?? false;
      const pruned = (result as Record<string, unknown> | null)?.pruned as number ?? 0;

      slog.info("db-maintenance completed", { ran, vacuumed, pruned });
      slog.exit("db-maintenance", { scheduleId: ctx.scheduleId });

      return { ran, vacuumed, pruned };
    },
  });
}
