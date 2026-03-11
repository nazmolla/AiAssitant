import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { addLog, deleteSchedulerScheduleById, getSchedulerScheduleById, getSchedulerTasksForSchedule, listSchedulerRunsBySchedule, updateSchedulerScheduleById } from "@/lib/db";
import { computeSchedulerNextRunAt, normalizeSchedulerIntervalExpr } from "@/lib/scheduler/next-run";

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
    message: `Fetched schedule detail for \"${schedule.name}\" (${schedule.id.slice(0, 8)}).`,
    metadata: JSON.stringify({ userId: auth.user.id, scheduleId: schedule.id }),
  });

  return NextResponse.json({ schedule, tasks, recent_runs: recentRuns });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const name = typeof (body as { name?: unknown }).name === "string" ? String((body as { name: string }).name).trim() : undefined;
  const triggerType = (body as { trigger_type?: unknown }).trigger_type;
  const triggerExprInput = typeof (body as { trigger_expr?: unknown }).trigger_expr === "string" ? String((body as { trigger_expr: string }).trigger_expr).trim() : undefined;
  const status = (body as { status?: unknown }).status;

  if (name !== undefined && !name) return NextResponse.json({ error: "name must not be empty" }, { status: 400 });
  if (triggerType !== undefined && !["cron", "interval", "once"].includes(String(triggerType))) {
    return NextResponse.json({ error: "trigger_type must be one of cron|interval|once" }, { status: 400 });
  }
  if (triggerExprInput !== undefined && !triggerExprInput) return NextResponse.json({ error: "trigger_expr must not be empty" }, { status: 400 });
  if (status !== undefined && !["active", "paused", "archived"].includes(String(status))) {
    return NextResponse.json({ error: "status must be one of active|paused|archived" }, { status: 400 });
  }

  const normalizedIntervalTriggerExpr = triggerExprInput !== undefined && String(triggerType ?? schedule.trigger_type) === "interval"
    ? normalizeSchedulerIntervalExpr(triggerExprInput)
    : undefined;

  if (triggerExprInput !== undefined && String(triggerType ?? schedule.trigger_type) === "interval" && !normalizedIntervalTriggerExpr) {
    return NextResponse.json(
      { error: "Invalid interval trigger_expr. Use formats like every:10:minute, every 10 minute, or 10 minute." },
      { status: 400 },
    );
  }

  const normalizedTriggerExpr = triggerExprInput === undefined
    ? undefined
    : (String(triggerType ?? schedule.trigger_type) === "interval"
      ? normalizedIntervalTriggerExpr || undefined
      : triggerExprInput);

  const effectiveTriggerType = (triggerType !== undefined ? String(triggerType) : schedule.trigger_type) as "cron" | "interval" | "once";
  const effectiveTriggerExpr = (normalizedTriggerExpr !== undefined ? normalizedTriggerExpr : schedule.trigger_expr) || "";
  const effectiveStatus = (status !== undefined ? String(status) : schedule.status) as "active" | "paused" | "archived";

  const recurrenceWasUpdated = triggerType !== undefined || triggerExprInput !== undefined;
  const activatedByUpdate = status !== undefined && String(status) === "active";
  const shouldRecompute = recurrenceWasUpdated || activatedByUpdate;

  let nextRunAt: string | null | undefined;
  if (shouldRecompute) {
    nextRunAt = effectiveStatus === "active"
      ? computeSchedulerNextRunAt(effectiveTriggerType, effectiveTriggerExpr)
      : schedule.next_run_at;
  }

  updateSchedulerScheduleById(schedule.id, {
    name,
    trigger_type: triggerType as "cron" | "interval" | "once" | undefined,
    trigger_expr: normalizedTriggerExpr,
    status: status as "active" | "paused" | "archived" | undefined,
    next_run_at: nextRunAt,
  });

  const updated = getSchedulerScheduleById(schedule.id);
  addLog({
    level: "info",
    source: "api.scheduler.control",
    message: `Updated schedule \"${updated?.name || schedule.name}\" (${schedule.id.slice(0, 8)}).`,
    metadata: JSON.stringify({
      userId: auth.user.id,
      scheduleId: schedule.id,
      triggerType: updated?.trigger_type || effectiveTriggerType,
      triggerExpr: updated?.trigger_expr || effectiveTriggerExpr,
      status: updated?.status || effectiveStatus,
    }),
  });

  return NextResponse.json({ ok: true, schedule: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const schedule = getSchedulerScheduleById(id);
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  const deleted = deleteSchedulerScheduleById(schedule.id);
  if (deleted < 1) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  addLog({
    level: "info",
    source: "api.scheduler.control",
    message: `Deleted schedule \"${schedule.name}\" (${schedule.id.slice(0, 8)}).`,
    metadata: JSON.stringify({ userId: auth.user.id, scheduleId: schedule.id, scheduleKey: schedule.schedule_key }),
  });

  return NextResponse.json({ ok: true, deleted: true, scheduleId: schedule.id });
}
