import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import {
  addLog,
  addSchedulerEvent,
  createSchedulerRun,
  createSchedulerTaskRun,
  getSchedulerScheduleById,
  getSchedulerTasksForSchedule,
} from "@/lib/db";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const schedule = getSchedulerScheduleById(id);
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  const run = createSchedulerRun(schedule.id, "api");
  const tasks = getSchedulerTasksForSchedule(schedule.id);
  for (const task of tasks) {
    createSchedulerTaskRun(run.id, task.id);
  }

  addSchedulerEvent(run.id, "run_triggered", "Scheduler run triggered via API", null, JSON.stringify({ scheduleId: schedule.id, taskCount: tasks.length }));
  addLog({
    level: "warning",
    source: "api.scheduler.control",
    message: "Triggered scheduler schedule run.",
    metadata: JSON.stringify({ userId: auth.user.id, scheduleId: schedule.id, runId: run.id }),
  });

  return NextResponse.json({ ok: true, run_id: run.id, task_count: tasks.length });
}
