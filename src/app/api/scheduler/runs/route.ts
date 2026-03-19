import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { addLog, listSchedulerRunsPaginated } from "@/lib/db";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("api.scheduler.runs");

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  log.enter("GET /api/scheduler/runs");
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const limit = Number.parseInt(searchParams.get("limit") || "50", 10);
  const offset = Number.parseInt(searchParams.get("offset") || "0", 10);
  const status = searchParams.get("status") || undefined;
  const scheduleId = searchParams.get("scheduleId") || undefined;

  const result = listSchedulerRunsPaginated(limit, offset, status, scheduleId);
  addLog({
    level: "verbose",
    source: "api.scheduler.runs",
    message: "Fetched scheduler runs.",
    metadata: JSON.stringify({ userId: auth.user.id, limit, offset, status: status || null, scheduleId: scheduleId || null }),
  });
  log.exit("GET /api/scheduler/runs", {}, Date.now() - t0);
  return NextResponse.json(result);
}
