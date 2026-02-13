import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { getThread, getThreadMessages, deleteThread } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { threadId: string } }
) {
  const denied = await requireOwner();
  if (denied) return denied;

  const thread = getThread(params.threadId);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const messages = getThreadMessages(params.threadId);
  return NextResponse.json({ thread, messages });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { threadId: string } }
) {
  const denied = await requireOwner();
  if (denied) return denied;

  const thread = getThread(params.threadId);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  deleteThread(params.threadId);
  return NextResponse.json({ success: true });
}
