import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { addLog, getSchedulerScheduleById, updateSchedulerScheduleStatus } from "@/lib/db";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const schedule = getSchedulerScheduleById(id);
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  updateSchedulerScheduleStatus(schedule.id, "active");
  addLog({
    level: "warning",
    source: "api.scheduler.control",
    message: "Resumed scheduler schedule.",
    metadata: JSON.stringify({ userId: auth.user.id, scheduleId: schedule.id }),
  });

  return NextResponse.json({ ok: true, status: "active", scheduleId: schedule.id });
}
