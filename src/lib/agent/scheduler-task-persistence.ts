/**
 * Scheduler task persistence from interactive chat messages.
 * Parses user messages for future/recurring task requests and persists
 * them into the unified scheduler queue.
 *
 * Extracted from loop.ts for SRP compliance.
 */

import {
  getThread,
  addLog,
  upsertSchedulerScheduleByKey,
  updateSchedulerTaskGraph,
  getDb,
} from "@/lib/db";
import { parseScheduledTasksFromUserMessage } from "@/lib/scheduler/task-parser";

/**
 * Parse the user message for scheduled task requests and persist them.
 * Only creates tasks for interactive user threads to avoid recursive
 * task creation when scheduled tasks themselves execute via runAgentLoop.
 */
export function persistScheduledTasksFromMessage(
  threadId: string,
  userMessage: string,
  userId: string | undefined
): void {
  if (!userId) return;

  const currentThread = getThread(threadId);
  if (currentThread?.thread_type !== "interactive") return;

  const parsedTasks = parseScheduledTasksFromUserMessage(userMessage);
  for (const task of parsedTasks) {
    try {
      const baseTaskName =
        task.taskName.replace(/^\s*(scheduled\s*task\s*:\s*)+/i, "").trim() || "Scheduled task";

      const triggerExpr =
        task.schedule.frequency === "once"
          ? "once"
          : `every:${Math.max(1, task.schedule.intervalValue)}:${
              task.schedule.frequency === "hourly"
                ? "hour"
                : task.schedule.frequency === "daily"
                  ? "day"
                  : task.schedule.frequency === "weekly"
                    ? "week"
                    : "month"
            }`;

      const scheduleKey = `user.${userId}.thread.${threadId}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

      upsertSchedulerScheduleByKey({
        schedule_key: scheduleKey,
        name: baseTaskName,
        handler_type: "agent.prompt",
        trigger_type: task.schedule.frequency === "once" ? "once" : "interval",
        trigger_expr: triggerExpr,
        status: "active",
        owner_type: "user",
        owner_id: userId,
        next_run_at: task.schedule.nextRunAt.toISOString(),
        retry_policy_json: JSON.stringify({ strategy: "none", maxAttempts: 1 }),
      });

      const scheduleRow = getDb()
        .prepare("SELECT id FROM scheduler_schedules WHERE schedule_key = ?")
        .get(scheduleKey) as { id: string } | undefined;
      if (!scheduleRow?.id) {
        throw new Error(`Unified schedule was not created for key: ${scheduleKey}`);
      }

      updateSchedulerTaskGraph(scheduleRow.id, [
        {
          task_key: "primary",
          name: baseTaskName,
          handler_name: "agent.prompt",
          execution_mode: "sync",
          sequence_no: 0,
          enabled: 1,
          config_json: JSON.stringify({
            kind: "agent_prompt",
            prompt: `Scheduled task: ${baseTaskName}`,
            userId,
            threadId,
          }),
        },
      ]);

      addLog({
        level: "info",
        source: "scheduler",
        message: "Created unified user schedule from interactive chat message.",
        metadata: JSON.stringify({ userId, threadId, taskName: baseTaskName, scheduleKey }),
      });
    } catch (err) {
      addLog({
        level: "warning",
        source: "scheduler",
        message: `Failed to persist user scheduled task: ${err}`,
        metadata: JSON.stringify({ threadId, userId, taskName: task.taskName }),
      });
    }
  }
}
