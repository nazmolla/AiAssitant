/**
 * Scheduler Agent: proactive-scan (issue #297)
 *
 * Deterministic replacement for ProactiveBatchJob free-form multi-iteration scan.
 * Accepts an explicit list of tool names to invoke and a static prompt — no novelty
 * tracking, no dynamic prompt mutation across iterations.
 *
 * Inputs:  toolNames (string[]), prompt (string), maxIterations (number), userId (string)
 * Outputs: toolsUsed (string[]), summary (string), threadId (string)
 */

import { createThread, getAppConfig, addLog } from "@/lib/db";
import { getDefaultAdminUserId } from "@/lib/scheduler/shared";
import { registerSchedulerAgent, type SchedulerAgentContext } from "../agent-registry";
import { createLogger } from "@/lib/logging/logger";

const slog = createLogger("scheduler.agents.proactive-scan");

export const PROACTIVE_SCAN_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    toolNames: {
      type: "array",
      items: { type: "string" },
      description: "Explicit list of tool names the agent must attempt to call.",
    },
    prompt: {
      type: "string",
      description: "Static system prompt for the proactive scan. Must not change between runs.",
    },
    maxIterations: {
      type: "number",
      description: "Max agent loop iterations.",
      default: 25,
    },
    userId: {
      type: "string",
      description: "User ID (falls back to default admin).",
    },
  },
  required: ["toolNames", "prompt"],
};

export const PROACTIVE_SCAN_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    toolsUsed: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    threadId: { type: "string" },
  },
  required: ["toolsUsed", "summary", "threadId"],
};

// Circuit-breaker shared with ProactiveBatchJob.
const AUTH_FAILURE_KEY = "proactive_scan_consecutive_auth_failures";
const AUTH_FAILURE_THRESHOLD = 3;

function getConsecutiveAuthFailures(): number {
  return parseInt(getAppConfig(AUTH_FAILURE_KEY) || "0", 10);
}

export function registerProactiveScanAgent(): void {
  registerSchedulerAgent({
    name: "proactive-scan",
    description: "Run a deterministic proactive scan: call the declared tool list with a static prompt.",
    input_schema: PROACTIVE_SCAN_INPUT_SCHEMA,
    output_schema: PROACTIVE_SCAN_OUTPUT_SCHEMA,
    async fn(inputs: Record<string, unknown>, ctx: SchedulerAgentContext): Promise<Record<string, unknown>> {
      slog.enter("proactive-scan", { scheduleId: ctx.scheduleId });

      const toolNames = Array.isArray(inputs.toolNames) ? (inputs.toolNames as string[]) : [];
      const prompt = typeof inputs.prompt === "string" ? inputs.prompt : "";
      const maxIterations = typeof inputs.maxIterations === "number" ? inputs.maxIterations : 25;

      if (!prompt) throw new Error("proactive-scan: 'prompt' input is required and must be a non-empty string.");

      // Circuit-breaker: skip if too many consecutive auth failures.
      const failures = getConsecutiveAuthFailures();
      if (failures >= AUTH_FAILURE_THRESHOLD) {
        addLog({
          level: "warning",
          source: "scheduler",
          message: `proactive-scan skipped — circuit-breaker open (${failures} consecutive auth failures).`,
          metadata: JSON.stringify({ scheduleId: ctx.scheduleId }),
        });
        return { toolsUsed: [], summary: "Skipped: circuit-breaker open due to repeated auth failures.", threadId: "" };
      }

      let userId = typeof inputs.userId === "string" ? inputs.userId : "";
      if (!userId) userId = getDefaultAdminUserId() ?? "";
      if (!userId) throw new Error("proactive-scan: no userId. Set schedule owner_id or pass userId input.");

      const thread = createThread("[proactive-scan]", userId, { threadType: "proactive" });

      // Build a deterministic context: static prompt + explicit tool list.
      const toolContext = toolNames.length > 0
        ? `\n\nRequired tools for this run (attempt each):\n${toolNames.map((t) => `- ${t}`).join("\n")}`
        : "";

      const { OrchestratorAgent, AgentRegistry } = await import("@/lib/agent/multi-agent");
      const registry = AgentRegistry.getInstance();
      const orchestrator = new OrchestratorAgent(registry);

      const result = await orchestrator.run(
        prompt + toolContext,
        { userId: "", threadId: thread.id, maxIterations },
      );

      slog.info("proactive-scan completed", { threadId: result.threadId, toolsUsed: result.toolsUsed.length });
      slog.exit("proactive-scan", { scheduleId: ctx.scheduleId });

      return {
        toolsUsed: result.toolsUsed,
        summary: result.response.slice(0, 1000),
        threadId: result.threadId,
      };
    },
  });
}
