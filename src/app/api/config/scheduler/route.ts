import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getAppConfig, setAppConfig, addLog } from "@/lib/db";
import { restartScheduler } from "@/lib/scheduler";

const CRON_REGEX = /^(\*(?:\/\d+)?|[0-9,\-\/]+)\s+(\*(?:\/\d+)?|[0-9,\-\/]+)\s+(\*(?:\/\d+)?|[0-9,\-\/]+)\s+(\*(?:\/\d+)?|[0-9,\-\/]+)\s+(\*(?:\/\d+)?|[0-9,\-\/]+)$/;
const CONFIG_KEY = "proactive_cron_schedule";
const DEFAULT_SCHEDULE = "*/15 * * * *";
const KM_ENABLED_KEY = "knowledge_maintenance_enabled";
const KM_HOUR_KEY = "knowledge_maintenance_hour";
const KM_MINUTE_KEY = "knowledge_maintenance_minute";
const KM_POLL_SECONDS_KEY = "knowledge_maintenance_poll_seconds";

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readKnowledgeMaintenanceConfig() {
  const enabledRaw = (getAppConfig(KM_ENABLED_KEY) ?? "1").trim().toLowerCase();
  const enabled = enabledRaw !== "0" && enabledRaw !== "false" && enabledRaw !== "no";

  return {
    enabled,
    hour: clampInt(getAppConfig(KM_HOUR_KEY), 20, 0, 23),
    minute: clampInt(getAppConfig(KM_MINUTE_KEY), 0, 0, 59),
    poll_seconds: clampInt(getAppConfig(KM_POLL_SECONDS_KEY), 60, 30, 300),
  };
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const schedule = getAppConfig(CONFIG_KEY) || DEFAULT_SCHEDULE;
  const knowledgeMaintenance = readKnowledgeMaintenanceConfig();
  addLog({
    level: "verbose",
    source: "api.config.scheduler",
    message: "Fetched scheduler configuration.",
    metadata: JSON.stringify({ schedule, knowledgeMaintenance }),
  });
  return NextResponse.json({
    cron_schedule: schedule,
    knowledge_maintenance: knowledgeMaintenance,
  });
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const schedule = String(body?.cron_schedule || "").trim();
    const kmRaw = body?.knowledge_maintenance || {};

    const existingKm = readKnowledgeMaintenanceConfig();
    const kmEnabled = typeof kmRaw?.enabled === "boolean" ? kmRaw.enabled : existingKm.enabled;
    const kmHour = clampInt(kmRaw?.hour, 20, 0, 23);
    const kmMinute = clampInt(kmRaw?.minute, 0, 0, 59);
    const kmPollSeconds = clampInt(kmRaw?.poll_seconds, 60, 30, 300);

    if (!schedule || !CRON_REGEX.test(schedule)) {
      return NextResponse.json(
        { error: "Invalid cron expression. Use standard 5-field cron format (e.g. */15 * * * *)." },
        { status: 400 }
      );
    }

    setAppConfig(CONFIG_KEY, schedule);
    setAppConfig(KM_ENABLED_KEY, kmEnabled ? "1" : "0");
    setAppConfig(KM_HOUR_KEY, String(kmHour));
    setAppConfig(KM_MINUTE_KEY, String(kmMinute));
    setAppConfig(KM_POLL_SECONDS_KEY, String(kmPollSeconds));
    restartScheduler();

    const knowledgeMaintenance = {
      enabled: kmEnabled,
      hour: kmHour,
      minute: kmMinute,
      poll_seconds: kmPollSeconds,
    };

    addLog({
      level: "warning",
      source: "api.config.scheduler",
      message: "Scheduler configuration updated.",
      metadata: JSON.stringify({ schedule, knowledgeMaintenance }),
    });
    return NextResponse.json({
      ok: true,
      cron_schedule: schedule,
      knowledge_maintenance: knowledgeMaintenance,
    });
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
