import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { addLog, getSchedulerQueueHealthMetrics, listEnabledSchedulerTaskHandlers } from "@/lib/db";

const REGISTERED_HANDLERS = new Set<string>([
  "legacy.scheduled_task.execute",
  "system.proactive.scan",
  "system.db_maintenance.run_due",
  "system.knowledge_maintenance.run_due",
  "workflow.job_scout.search",
  "workflow.job_scout.extract",
  "workflow.job_scout.prepare",
  "workflow.job_scout.validate",
  "workflow.job_scout.email",
]);

export async function GET(_req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const metrics = getSchedulerQueueHealthMetrics();
  const handlers = listEnabledSchedulerTaskHandlers();
  const orphan_handlers = handlers.filter((h) => !REGISTERED_HANDLERS.has(h.handler_name));

  const warnings: string[] = [];
  if (metrics.queued > 100) warnings.push("High scheduler queue depth.");
  if (metrics.failed_1h > 10) warnings.push("High scheduler failure rate over last hour.");
  if (metrics.stale_claims > 0) warnings.push("Stale scheduler claims detected.");
  if (orphan_handlers.length > 0) warnings.push("Enabled scheduler tasks found with unregistered handlers.");

  addLog({
    level: warnings.length > 0 ? "warning" : "verbose",
    source: "api.scheduler.health",
    message: "Fetched scheduler health metrics.",
    metadata: JSON.stringify({ userId: auth.user.id, warnings: warnings.length, orphanHandlers: orphan_handlers.length }),
  });

  return NextResponse.json({
    metrics,
    orphan_handlers,
    warnings,
    status: warnings.length > 0 ? "degraded" : "healthy",
  });
}
