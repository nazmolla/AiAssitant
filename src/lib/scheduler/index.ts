/**
 * Proactive Scheduler (The Observer)
 *
 * Runs as a background cron job that:
 * 1. Polls data from proactive-enabled MCP tools
 * 2. Fetches relevant user knowledge for context
 * 3. Calls the LLM to assess if any information requires action
 * 4. Creates approval requests or notifications as needed
 */

import { CronJob } from "cron";
import { getMcpManager } from "@/lib/mcp";
import { createChatProvider } from "@/lib/llm";
import {
  listToolPolicies,
  listKnowledge,
  getToolPolicy,
  addLog,
  createApprovalRequest,
  createThread,
  addMessage,
} from "@/lib/db";

const PROACTIVE_SYSTEM_PROMPT = `You are the Nexus proactive observer. You have been given data polled from external services.

Your job:
1. Analyze the data for anything noteworthy, urgent, or requiring the owner's attention.
2. If an action is needed, respond with a JSON object: { "action_needed": true, "tool": "tool_name", "args": {}, "reasoning": "why" }
3. If no action is needed, respond with: { "action_needed": false, "summary": "brief note" }
4. Consider the user's known preferences and context.

Always respond with valid JSON only.`;

let _cronJob: CronJob | null = null;

/**
 * Run a single proactive scan cycle.
 */
export async function runProactiveScan(): Promise<void> {
  addLog({
    level: "info",
    source: "scheduler",
    message: "Proactive scan started.",
    metadata: null,
  });

  const mcpManager = getMcpManager();
  const policies = listToolPolicies().filter((p) => p.is_proactive_enabled);

  if (policies.length === 0) {
    addLog({
      level: "info",
      source: "scheduler",
      message: "No proactive-enabled tools configured. Skipping scan.",
      metadata: null,
    });
    return;
  }

  // Build knowledge context
  const knowledge = listKnowledge();
  const knowledgeContext = knowledge
    .map((k) => `- ${k.entity} / ${k.attribute}: ${k.value}`)
    .join("\n");

  for (const policy of policies) {
    try {
      // Poll the tool for data (assuming list/read-type tools)
      const result = await mcpManager.callTool(policy.tool_name, {});
      const polledData = JSON.stringify(result);

      addLog({
        level: "info",
        source: "scheduler",
        message: `Polled data from "${policy.tool_name}".`,
        metadata: JSON.stringify({ dataPreview: polledData.substring(0, 200) }),
      });

      // Ask the LLM to assess
      const provider = createChatProvider();
      const response = await provider.chat(
        [
          {
            role: "user",
            content: `[Polled Data from ${policy.tool_name}]\n${polledData}\n\n[User Knowledge]\n${knowledgeContext}`,
          },
        ],
        undefined,
        PROACTIVE_SYSTEM_PROMPT
      );

      if (!response.content) continue;

      try {
        const assessment = JSON.parse(response.content);

        if (assessment.action_needed) {
          const actionTool = assessment.tool || policy.tool_name;
          const actionPolicy =
            actionTool === policy.tool_name ? policy : getToolPolicy(actionTool);
          const requiresApproval = actionPolicy
            ? actionPolicy.requires_approval !== 0
            : true;
          const actionArgs =
            assessment.args && typeof assessment.args === "object" && !Array.isArray(assessment.args)
              ? (assessment.args as Record<string, unknown>)
              : {};

          addLog({
            level: "info",
            source: "scheduler",
            message: `Proactive action triggered: ${assessment.reasoning}`,
            metadata: JSON.stringify(assessment),
          });

          // Create a proactive thread
          const thread = createThread(`[Proactive] ${policy.tool_name}`);

          addMessage({
            thread_id: thread.id,
            role: "system",
            content: `Proactive scan detected an action from "${policy.tool_name}": ${assessment.reasoning}`,
            tool_calls: null,
            tool_results: null,
          });

          if (requiresApproval) {
            createApprovalRequest({
              thread_id: thread.id,
              tool_name: actionTool,
              args: JSON.stringify(actionArgs),
              reasoning: assessment.reasoning,
            });
          } else {
            try {
              const executionResult = await mcpManager.callTool(
                actionTool,
                actionArgs
              );

              addLog({
                level: "info",
                source: "scheduler",
                message: `Proactive tool "${actionTool}" executed automatically.`,
                metadata: JSON.stringify({
                  resultPreview: JSON.stringify(executionResult).substring(0, 200),
                }),
              });

              addMessage({
                thread_id: thread.id,
                role: "tool",
                content: JSON.stringify(executionResult),
                tool_calls: null,
                tool_results: JSON.stringify({ name: actionTool, result: executionResult }),
              });

              addMessage({
                thread_id: thread.id,
                role: "assistant",
                content: `✅ Proactive action "${actionTool}" completed: ${assessment.reasoning}`,
                tool_calls: null,
                tool_results: null,
              });
            } catch (executionError) {
              addLog({
                level: "error",
                source: "scheduler",
                message: `Auto-executed tool "${actionTool}" failed: ${executionError}`,
                metadata: null,
              });

              addMessage({
                thread_id: thread.id,
                role: "system",
                content: `⚠️ Failed to execute proactive action "${actionTool}": ${executionError}`,
                tool_calls: null,
                tool_results: null,
              });
            }
          }
        } else {
          addLog({
            level: "info",
            source: "scheduler",
            message: `No action needed for "${policy.tool_name}": ${assessment.summary}`,
            metadata: null,
          });
        }
      } catch {
        addLog({
          level: "warn",
          source: "scheduler",
          message: `Failed to parse LLM assessment for "${policy.tool_name}".`,
          metadata: JSON.stringify({ rawResponse: response.content }),
        });
      }
    } catch (err) {
      addLog({
        level: "error",
        source: "scheduler",
        message: `Error polling "${policy.tool_name}": ${err}`,
        metadata: null,
      });
    }
  }

  addLog({
    level: "info",
    source: "scheduler",
    message: "Proactive scan completed.",
    metadata: null,
  });
}

/**
 * Start the proactive scheduler cron job.
 */
export function startScheduler(): void {
  if (_cronJob) {
    _cronJob.stop();
  }

  const schedule = process.env.PROACTIVE_CRON_SCHEDULE || "*/15 * * * *";

  _cronJob = new CronJob(schedule, async () => {
    try {
      await runProactiveScan();
    } catch (err) {
      addLog({
        level: "error",
        source: "scheduler",
        message: `Scheduler error: ${err}`,
        metadata: null,
      });
    }
  });

  _cronJob.start();

  addLog({
    level: "info",
    source: "scheduler",
    message: `Proactive scheduler started with schedule: ${schedule}`,
    metadata: null,
  });
}

/**
 * Stop the proactive scheduler.
 */
export function stopScheduler(): void {
  if (_cronJob) {
    _cronJob.stop();
    _cronJob = null;
    addLog({
      level: "info",
      source: "scheduler",
      message: "Proactive scheduler stopped.",
      metadata: null,
    });
  }
}
