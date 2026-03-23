import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getApprovalById } from "@/lib/db/tool-policy-queries";
import { getThread } from "@/lib/db/thread-queries";
import { getDb } from "@/lib/db/connection";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  let body: { approvalId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { approvalId } = body;
  if (!approvalId || typeof approvalId !== "string") {
    return NextResponse.json({ error: "approvalId is required." }, { status: 400 });
  }

  const approval = getApprovalById(approvalId);
  if (!approval) {
    return NextResponse.json({ error: "Approval not found." }, { status: 404 });
  }

  // Validate the approval belongs to the user (check thread ownership)
  if (auth.user.role !== "admin") {
    if (!approval.thread_id) {
      // Proactive approvals (no thread) are admin-only
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const thread = getThread(approval.thread_id);
    if (!thread || thread.user_id !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (approval.status !== "rejected") {
    return NextResponse.json(
      { error: `Approval is not in 'rejected' state (current: ${approval.status}).` },
      { status: 400 }
    );
  }

  getDb()
    .prepare("UPDATE approval_queue SET status = 'pending', resolved_at = NULL WHERE id = ?")
    .run(approvalId);

  return NextResponse.json({ ok: true, approvalId });
}
