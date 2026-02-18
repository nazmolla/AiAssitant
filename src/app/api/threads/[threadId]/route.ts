import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getThread, getThreadMessages, deleteThread } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { threadId: string } }
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const thread = getThread(params.threadId);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  // Ensure user owns this thread
  if (thread.user_id && thread.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const messages = getThreadMessages(params.threadId);
  return NextResponse.json({ thread, messages });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { threadId: string } }
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const thread = getThread(params.threadId);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  if (thread.user_id && thread.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  deleteThread(params.threadId);
  return NextResponse.json({ success: true });
}
