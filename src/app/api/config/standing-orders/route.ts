import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import {
  listApprovalPreferences,
  updateApprovalPreferenceDecision,
  deleteApprovalPreference,
  deleteAllApprovalPreferences,
} from "@/lib/db";

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const prefs = listApprovalPreferences(auth.user.id);
  return NextResponse.json(prefs);
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { id, decision } = body as { id?: string; decision?: string };

  if (!id || !decision || !["approved", "rejected", "ignored"].includes(decision)) {
    return NextResponse.json(
      { error: "id and decision ('approved' | 'rejected' | 'ignored') are required." },
      { status: 400 }
    );
  }

  const ok = updateApprovalPreferenceDecision(
    id,
    auth.user.id,
    decision as "approved" | "rejected" | "ignored"
  );

  if (!ok) {
    return NextResponse.json({ error: "Standing order not found or not owned by you." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const ok = deleteApprovalPreference(id, auth.user.id);
    if (!ok) {
      return NextResponse.json({ error: "Standing order not found or not owned by you." }, { status: 404 });
    }
    return NextResponse.json({ success: true, deleted: 1 });
  }

  // No id → delete all
  const count = deleteAllApprovalPreferences(auth.user.id);
  return NextResponse.json({ success: true, deleted: count });
}
