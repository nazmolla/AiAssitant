import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import {
  addLog,
  addSchedulerEvent,
  createSchedulerRun,
  createSchedulerTaskRun,
  getSchedulerScheduleById,
  getSchedulerTasksForSchedule,
  updateSchedulerScheduleById,
} from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional
  }

  const schedule = getSchedulerScheduleById(id);
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  // For Job Scout batches without an owner, bind the owner to the specified user_id (or request body's user_id)
  const needsOwnerBinding = schedule.handler_type === "workflow.job_scout" && !schedule.owner_id;
  if (needsOwnerBinding) {
    const requestedUserId = typeof (body as { user_id?: unknown }).user_id === "string" 
      ? String((body as { user_id: string }).user_id).trim() 
      : undefined;
    
    if (!requestedUserId) {
      return NextResponse.json(
        { error: "Job Scout batches require a user_id to specify which user this batch is for." },
        { status: 400 }
      );
    }
    
    updateSchedulerScheduleById(schedule.id, { owner_type: "user", owner_id: requestedUserId });
  }

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
