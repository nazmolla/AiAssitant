import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getAppConfig, setAppConfig, addLog } from "@/lib/db";
import { restartScheduler } from "@/lib/scheduler";

const CRON_REGEX = /^(\*(?:\/\d+)?|[0-9,\-\/]+)\s+(\*(?:\/\d+)?|[0-9,\-\/]+)\s+(\*(?:\/\d+)?|[0-9,\-\/]+)\s+(\*(?:\/\d+)?|[0-9,\-\/]+)\s+(\*(?:\/\d+)?|[0-9,\-\/]+)$/;
const CONFIG_KEY = "proactive_cron_schedule";
const DEFAULT_SCHEDULE = "*/15 * * * *";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const schedule = getAppConfig(CONFIG_KEY) || DEFAULT_SCHEDULE;
  addLog({
    level: "verbose",
    source: "api.config.scheduler",
    message: "Fetched scheduler configuration.",
    metadata: JSON.stringify({ schedule }),
  });
  return NextResponse.json({ cron_schedule: schedule });
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const schedule = String(body?.cron_schedule || "").trim();

    if (!schedule || !CRON_REGEX.test(schedule)) {
      return NextResponse.json(
        { error: "Invalid cron expression. Use standard 5-field cron format (e.g. */15 * * * *)." },
        { status: 400 }
      );
    }

    setAppConfig(CONFIG_KEY, schedule);
    restartScheduler();

    addLog({
      level: "warning",
      source: "api.config.scheduler",
      message: "Proactive scheduler schedule updated and restarted.",
      metadata: JSON.stringify({ schedule }),
    });
    return NextResponse.json({ ok: true, cron_schedule: schedule });
  } catch (err) {
    addLog({
      level: "error",
      source: "api.config.scheduler",
      message: "Failed to update scheduler config.",
      metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    });
    return NextResponse.json({ error: "Failed to update scheduler config." }, { status: 500 });
  }
}
