import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { addLog, getSchedulerOverviewStats, listSchedulerRunsPaginated, listSchedulerSchedulesPaginated } from "@/lib/db";

export async function GET(_req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const stats = getSchedulerOverviewStats();
  const dueSoon = listSchedulerSchedulesPaginated(10, 0, "active").data
    .filter((s) => !!s.next_run_at)
    .sort((a, b) => String(a.next_run_at).localeCompare(String(b.next_run_at)))
    .slice(0, 5);
  const recentRuns = listSchedulerRunsPaginated(10, 0).data;

  addLog({
    level: "verbose",
    source: "api.scheduler.overview",
    message: "Fetched scheduler overview.",
    metadata: JSON.stringify({ userId: auth.user.id }),
  });

  return NextResponse.json({
    ...stats,
    due_soon: dueSoon,
    recent_runs: recentRuns,
  });
}
