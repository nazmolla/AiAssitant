import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireUser } from "@/lib/auth";
import { getRecentLogs, deleteAllLogs, deleteLogsByLevel, deleteLogsOlderThanDays, addLog } from "@/lib/db";
import { isUnifiedLogLevel } from "@/lib/logging/levels";

async function requireLogsReadAccess() {
  const auth = await requireUser();
  if ("error" in auth) return auth;

  if (!auth.user.apiKeyScopes) {
    if (auth.user.role === "admin") return auth;
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  if (!auth.user.apiKeyScopes.includes("logs")) {
    return { error: NextResponse.json({ error: "API key missing required scope: logs" }, { status: 403 }) };
  }

  return auth;
}

export async function GET(req: NextRequest) {
  const auth = await requireLogsReadAccess();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const limitParam = (searchParams.get("limit") || "100").trim().toLowerCase();
  const levelParam = (searchParams.get("level") || "all").trim().toLowerCase();
  const sourceParam = (searchParams.get("source") || "all").trim().toLowerCase();
  const limit = limitParam === "all"
    ? Number.NaN
    : Math.max(1, Math.min(Number.parseInt(limitParam, 10) || 100, 1000));

  const level = isUnifiedLogLevel(levelParam) ? levelParam : "all";
  const source = sourceParam || "all";

  const logs = getRecentLogs(limit, level, source);
  return NextResponse.json(logs);
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json().catch(() => ({}));
    const mode = String(body?.mode || "").toLowerCase();

    if (mode === "all") {
      const deleted = deleteAllLogs();
      return NextResponse.json({ ok: true, deleted });
    }

    if (mode === "level") {
      const level = String(body?.level || "").toLowerCase();
      if (!isUnifiedLogLevel(level)) {
        addLog({
          level: "warning",
          source: "api.logs",
          message: "Rejected log cleanup request due to invalid level.",
          metadata: JSON.stringify({ mode, level }),
        });
        return NextResponse.json({ error: "Invalid log level." }, { status: 400 });
      }
      const deleted = deleteLogsByLevel(level);
      return NextResponse.json({ ok: true, deleted });
    }

    if (mode === "older-than-days") {
      const days = Number.parseInt(String(body?.days || ""), 10);
      if (!Number.isFinite(days) || days < 1) {
        addLog({
          level: "warning",
          source: "api.logs",
          message: "Rejected log cleanup request due to invalid days value.",
          metadata: JSON.stringify({ mode, days: body?.days }),
        });
        return NextResponse.json({ error: "Invalid days value." }, { status: 400 });
      }
      const deleted = deleteLogsOlderThanDays(days);
      return NextResponse.json({ ok: true, deleted });
    }

    addLog({
      level: "warning",
      source: "api.logs",
      message: "Rejected log cleanup request due to invalid mode.",
      metadata: JSON.stringify({ mode }),
    });
    return NextResponse.json({ error: "Invalid cleanup mode." }, { status: 400 });
  } catch (err) {
    addLog({
      level: "error",
      source: "api.logs",
      message: "Failed to clean logs.",
      metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    });
    return NextResponse.json({ error: "Failed to clean logs." }, { status: 500 });
  }
}
