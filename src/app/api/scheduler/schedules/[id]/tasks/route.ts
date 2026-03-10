import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { addLog, getSchedulerScheduleById, getSchedulerTasksForSchedule, updateSchedulerTaskGraph } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const schedule = getSchedulerScheduleById(id);
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tasks = (body as { tasks?: Array<Record<string, unknown>> })?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return NextResponse.json({ error: "tasks[] is required" }, { status: 400 });
  }

  const normalized = tasks.map((task, index) => {
    const task_key = String(task.task_key || `task_${index + 1}`).trim();
    const name = String(task.name || task_key).trim();
    const handler_name = String(task.handler_name || "").trim();
    if (!handler_name) throw new Error(`Task ${task_key} missing handler_name`);

    return {
      id: typeof task.id === "string" ? task.id : undefined,
      task_key,
      name,
      handler_name,
      execution_mode: (task.execution_mode as "sync" | "async" | "fanout") || "sync",
      sequence_no: Number.isFinite(task.sequence_no as number) ? Number(task.sequence_no) : index,
      timeout_sec: task.timeout_sec as number | null | undefined,
      retry_policy_json: task.retry_policy_json ? JSON.stringify(task.retry_policy_json) : null,
      enabled: task.enabled === 0 ? 0 : 1,
      config_json: task.config_json ? JSON.stringify(task.config_json) : null,
    };
  });

  try {
    updateSchedulerTaskGraph(schedule.id, normalized);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  const updatedTasks = getSchedulerTasksForSchedule(schedule.id);
  addLog({
    level: "warning",
    source: "api.scheduler.control",
    message: "Updated scheduler task graph.",
    metadata: JSON.stringify({ userId: auth.user.id, scheduleId: schedule.id, taskCount: updatedTasks.length }),
  });

  return NextResponse.json({ ok: true, schedule_id: schedule.id, tasks: updatedTasks });
}
