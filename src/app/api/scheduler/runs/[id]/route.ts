import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { addLog, getSchedulerRunWithContext } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const context = getSchedulerRunWithContext(id);
  if (!context) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  addLog({
    level: "verbose",
    source: "api.scheduler.run",
    message: "Fetched scheduler run detail.",
    metadata: JSON.stringify({ userId: auth.user.id, runId: id }),
  });

  return NextResponse.json(context);
}
