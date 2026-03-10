import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { addLog, getSchedulerScheduleById, getSchedulerTasksForSchedule, listSchedulerRunsBySchedule } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const schedule = getSchedulerScheduleById(id);
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  const tasks = getSchedulerTasksForSchedule(schedule.id);
  const recentRuns = listSchedulerRunsBySchedule(schedule.id, 20);

  addLog({
    level: "verbose",
    source: "api.scheduler.schedule",
    message: "Fetched scheduler schedule detail.",
    metadata: JSON.stringify({ userId: auth.user.id, scheduleId: schedule.id }),
  });

  return NextResponse.json({ schedule, tasks, recent_runs: recentRuns });
}
