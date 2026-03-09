import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  addLog,
  getDbMaintenanceConfig,
  getDbStorageStats,
  getHostResourceUsage,
  runDbMaintenance,
  setDbMaintenanceConfig,
  type DbMaintenanceConfig,
} from "@/lib/db";

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes") return true;
    if (v === "false" || v === "0" || v === "no") return false;
  }
  return fallback;
}

function toSafeInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const config = getDbMaintenanceConfig();
  const storage = getDbStorageStats();
  const resources = getHostResourceUsage();

  return NextResponse.json({ config, storage, resources });
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const current = getDbMaintenanceConfig();

    const update: Partial<DbMaintenanceConfig> = {
      enabled: toBool(body?.enabled, current.enabled),
      intervalHours: toSafeInt(body?.intervalHours, current.intervalHours, 1, 24 * 30),
      logsRetentionDays: toSafeInt(body?.logsRetentionDays, current.logsRetentionDays, 1, 3650),
      threadsRetentionDays: toSafeInt(body?.threadsRetentionDays, current.threadsRetentionDays, 1, 3650),
      attachmentsRetentionDays: toSafeInt(body?.attachmentsRetentionDays, current.attachmentsRetentionDays, 1, 3650),
      cleanupLogs: toBool(body?.cleanupLogs, current.cleanupLogs),
      cleanupThreads: toBool(body?.cleanupThreads, current.cleanupThreads),
      cleanupAttachments: toBool(body?.cleanupAttachments, current.cleanupAttachments),
      cleanupOrphanFiles: toBool(body?.cleanupOrphanFiles, current.cleanupOrphanFiles),
    };

    const config = setDbMaintenanceConfig(update);

    addLog({
      level: "warning",
      source: "api.config.db-management",
      message: "DB maintenance policy updated.",
      metadata: JSON.stringify({ userId: auth.user.id, config }),
    });

    return NextResponse.json({ ok: true, config });
  } catch (err) {
    addLog({
      level: "error",
      source: "api.config.db-management",
      message: "Failed to update DB maintenance policy.",
      metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    });
    return NextResponse.json({ error: "Failed to update DB maintenance policy." }, { status: 500 });
  }
}

export async function POST() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const result = runDbMaintenance("manual");
    const storage = getDbStorageStats();

    addLog({
      level: "warning",
      source: "api.config.db-management",
      message: "DB maintenance run executed manually.",
      metadata: JSON.stringify({ userId: auth.user.id, result }),
    });

    return NextResponse.json({ ok: true, result, storage });
  } catch (err) {
    addLog({
      level: "error",
      source: "api.config.db-management",
      message: "Manual DB maintenance run failed.",
      metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    });
    return NextResponse.json({ error: "Manual DB maintenance run failed." }, { status: 500 });
  }
}
