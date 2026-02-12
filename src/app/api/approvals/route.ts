import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { listPendingApprovals, updateApprovalStatus } from "@/lib/db";
import { executeApprovedTool } from "@/lib/agent";

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const pending = listPendingApprovals();
  return NextResponse.json(pending);
}

export async function POST(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  const body = await req.json();
  const { approvalId, action } = body;

  if (!approvalId || !["approved", "rejected"].includes(action)) {
    return NextResponse.json(
      { error: "approvalId and action ('approved' | 'rejected') are required." },
      { status: 400 }
    );
  }

  // Find the approval
  const pending = listPendingApprovals();
  const approval = pending.find((a) => a.id === approvalId);

  if (!approval) {
    return NextResponse.json({ error: "Approval not found or already resolved." }, { status: 404 });
  }

  updateApprovalStatus(approvalId, action);

  if (action === "approved" && approval.thread_id) {
    // Execute the tool now
    const args = JSON.parse(approval.args);
    const result = await executeApprovedTool(approval.tool_name, args, approval.thread_id);
    return NextResponse.json({ status: "approved", result });
  }

  return NextResponse.json({ status: action });
}
