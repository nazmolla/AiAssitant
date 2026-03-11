import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { addLog, createSchedulerSchedule, listSchedulerSchedulesPaginated, updateSchedulerTaskGraph } from "@/lib/db";
import { getBatchJob, type BatchJobType, type BatchJobSubTaskTemplate } from "@/lib/scheduler/batch-jobs";
import { computeSchedulerNextRunAt, normalizeSchedulerIntervalExpr } from "@/lib/scheduler/next-run";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const limit = Number.parseInt(searchParams.get("limit") || "50", 10);
  const offset = Number.parseInt(searchParams.get("offset") || "0", 10);
  const status = searchParams.get("status") || undefined;

  const result = listSchedulerSchedulesPaginated(limit, offset, status);
  addLog({
    level: "verbose",
    source: "api.scheduler.schedules",
    message: "Fetched scheduler schedules.",
    metadata: JSON.stringify({ userId: auth.user.id, limit, offset, status: status || null }),
  });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const batchType = String((body as { batch_type?: unknown }).batch_type || "").trim() as BatchJobType;
  if (!batchType || !["proactive", "knowledge", "cleanup", "email"].includes(batchType)) {
    return NextResponse.json({ error: "batch_type must be one of proactive|knowledge|cleanup|email" }, { status: 400 });
  }

  const name = typeof (body as { name?: unknown }).name === "string" ? String((body as { name: string }).name).trim() : undefined;
  const triggerType = String((body as { trigger_type?: unknown }).trigger_type || "interval").trim() as "cron" | "interval" | "once";
  const triggerExprInput = String((body as { trigger_expr?: unknown }).trigger_expr || "").trim();
  const parameters = ((body as { parameters?: unknown }).parameters || {}) as Record<string, string>;
  const tasks = ((body as { tasks?: unknown }).tasks || undefined) as BatchJobSubTaskTemplate[] | undefined;

  if (!["cron", "interval", "once"].includes(triggerType)) {
    return NextResponse.json({ error: "trigger_type must be one of cron|interval|once" }, { status: 400 });
  }
  if (!triggerExprInput) {
    return NextResponse.json({ error: "trigger_expr is required" }, { status: 400 });
  }

  const normalizedTriggerExpr = triggerType === "interval"
    ? normalizeSchedulerIntervalExpr(triggerExprInput)
    : triggerExprInput;
  if (triggerType === "interval" && !normalizedTriggerExpr) {
    return NextResponse.json(
      { error: "Invalid interval trigger_expr. Use formats like every:10:minute, every 10 minute, or 10 minute." },
      { status: 400 },
    );
  }

  const job = getBatchJob(batchType);
  const built = job.build({ name, trigger_type: triggerType, trigger_expr: normalizedTriggerExpr || triggerExprInput, parameters, tasks });
  const nextRunAt = computeSchedulerNextRunAt(built.trigger_type, built.trigger_expr);

  const schedule = createSchedulerSchedule({
    schedule_key: built.schedule_key,
    name: built.name,
    handler_type: built.handler_type,
    trigger_type: built.trigger_type,
    trigger_expr: built.trigger_expr,
    owner_type: "user",
    owner_id: auth.user.id,
    status: "active",
    next_run_at: nextRunAt,
  });

  updateSchedulerTaskGraph(
    schedule.id,
    built.tasks.map((task, index) => ({
      task_key: task.task_key,
      name: task.name,
      handler_name: task.handler_name,
      execution_mode: task.execution_mode,
      sequence_no: Number.isFinite(task.sequence_no) ? task.sequence_no : index,
      depends_on_task_key: task.depends_on_task_key || null,
      enabled: task.enabled === 0 ? 0 : 1,
      config_json: JSON.stringify({
        ...(task.config_json || {}),
        task_type: task.task_type || "handler",
        prompt: task.prompt || (task.config_json && typeof task.config_json.prompt === "string" ? task.config_json.prompt : undefined),
      }),
    })),
    true,
  );

  addLog({
    level: "info",
    source: "api.scheduler.schedules",
    message: `Created ${batchType} batch schedule \"${schedule.name}\" (${schedule.id.slice(0, 8)}).`,
    metadata: JSON.stringify({ userId: auth.user.id, scheduleId: schedule.id, batchType, triggerType: schedule.trigger_type, triggerExpr: schedule.trigger_expr }),
  });

  return NextResponse.json({ ok: true, schedule_id: schedule.id, schedule_key: schedule.schedule_key });
}
