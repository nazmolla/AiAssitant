import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { addLog, listSchedulerSchedulesPaginated } from "@/lib/db";

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
