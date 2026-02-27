import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getServerMinLogLevel, setServerMinLogLevel, addLog } from "@/lib/db";
import { isUnifiedLogLevel } from "@/lib/logging/levels";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const minLevel = getServerMinLogLevel();
  addLog({
    level: "verbose",
    source: "api.config.logging",
    message: "Fetched server logging configuration.",
    metadata: JSON.stringify({ minLevel }),
  });
  return NextResponse.json({ min_level: minLevel });
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const level = String(body?.min_level || "").toLowerCase();
    if (!isUnifiedLogLevel(level)) {
      return NextResponse.json({ error: "Invalid minimum log level." }, { status: 400 });
    }

    setServerMinLogLevel(level);
    addLog({
      level: "warning",
      source: "api.config.logging",
      message: "Server minimum log level updated.",
      metadata: JSON.stringify({ minLevel: level }),
    });
    return NextResponse.json({ ok: true, min_level: level });
  } catch (err) {
    addLog({
      level: "error",
      source: "api.config.logging",
      message: "Failed to update logging config.",
      metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    });
    return NextResponse.json({ error: "Failed to update logging config." }, { status: 500 });
  }
}
