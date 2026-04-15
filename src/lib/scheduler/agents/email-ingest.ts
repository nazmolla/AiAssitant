/**
 * Scheduler Agent: email-ingest (issue #297)
 *
 * Deterministic replacement for the EmailBatchJob free-form orchestrator call.
 * Inputs:  maxMessages (optional), sinceTimestamp (optional ISO string)
 * Outputs: processed (number), errors (string[]), threadId (string)
 */

import { createThread, getSchedulerScheduleById, listSchedulerRunsBySchedule } from "@/lib/db";
import { registerSchedulerAgent, type SchedulerAgentContext } from "../agent-registry";
import { OrchestratorAgent, AgentRegistry } from "@/lib/agent/multi-agent";
import { EMAIL_BATCH_TASK_PROMPT } from "@/lib/prompts";
import { createLogger } from "@/lib/logging/logger";

const slog = createLogger("scheduler.agents.email-ingest");

export const EMAIL_INGEST_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    maxMessages: { type: "number", description: "Maximum emails to process per run", default: 50 },
    sinceTimestamp: { type: "string", description: "ISO timestamp — only process emails after this time" },
    userId: { type: "string", description: "User ID override (falls back to schedule owner)" },
  },
  required: [],
};

export const EMAIL_INGEST_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    processed: { type: "number" },
    errors: { type: "array", items: { type: "string" } },
    threadId: { type: "string" },
  },
  required: ["processed", "errors", "threadId"],
};

export function registerEmailIngestAgent(): void {
  registerSchedulerAgent({
    name: "email-ingest",
    description: "Process incoming emails: scan inbox, classify, and respond via OrchestratorAgent.",
    input_schema: EMAIL_INGEST_INPUT_SCHEMA,
    output_schema: EMAIL_INGEST_OUTPUT_SCHEMA,
    async fn(inputs: Record<string, unknown>, ctx: SchedulerAgentContext): Promise<Record<string, unknown>> {
      slog.enter("email-ingest", { scheduleId: ctx.scheduleId });

      let userId = typeof inputs.userId === "string" ? inputs.userId : "";
      if (!userId) {
        const schedule = getSchedulerScheduleById(ctx.scheduleId);
        userId = schedule?.owner_id ?? "";
      }
      if (!userId) throw new Error("email-ingest: no userId. Set schedule owner_id or pass userId input.");

      // Determine since-timestamp for deduplication.
      let sinceTimestamp: string;
      if (typeof inputs.sinceTimestamp === "string" && inputs.sinceTimestamp) {
        sinceTimestamp = inputs.sinceTimestamp;
      } else {
        const previousRuns = listSchedulerRunsBySchedule(ctx.scheduleId, 10);
        const lastSuccess = previousRuns.find((r) => r.status === "success" && r.started_at);
        sinceTimestamp = lastSuccess?.started_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      }

      const schedule = getSchedulerScheduleById(ctx.scheduleId);
      const title = schedule ? `Email Batch: ${schedule.name}` : "Email Batch";
      const thread = createThread(title, userId, { threadType: "scheduled" });

      const sinceContext = `\n\nEMAIL DEDUPLICATION: Only process emails that arrived after ${sinceTimestamp}. Pass since="${sinceTimestamp}" to builtin.channel_receive.`;

      const registry = AgentRegistry.getInstance();
      const orchestrator = new OrchestratorAgent(registry);
      const result = await orchestrator.run(
        `${EMAIL_BATCH_TASK_PROMPT}\n\n## System context${sinceContext}`,
        { userId, threadId: thread.id },
      );

      slog.info("email-ingest completed", { threadId: result.threadId, toolsUsed: result.toolsUsed.length });
      slog.exit("email-ingest", { scheduleId: ctx.scheduleId });

      return {
        processed: result.toolsUsed.length,
        errors: [],
        threadId: result.threadId,
      };
    },
  });
}
