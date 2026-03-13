import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getThread, deleteMessagesFrom } from "@/lib/db";
import type { AttachmentMeta } from "@/lib/db/thread-queries";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params;
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const thread = getThread(threadId);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  if (thread.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { messageId } = body as { messageId?: number };

  if (typeof messageId !== "number" || !Number.isInteger(messageId)) {
    return NextResponse.json({ error: "messageId must be an integer" }, { status: 400 });
  }

  const deleted = deleteMessagesFrom(threadId, messageId);
  if (!deleted) {
    return NextResponse.json({ error: "Message not found in this thread" }, { status: 404 });
  }

  if (deleted.role !== "user") {
    return NextResponse.json(
      { error: "Can only restore to a user message" },
      { status: 400 }
    );
  }

  let attachments: AttachmentMeta[] = [];
  if (deleted.attachments) {
    try {
      attachments = JSON.parse(deleted.attachments);
    } catch {
      // ignore malformed attachment JSON
    }
  }

  return NextResponse.json({
    content: deleted.content,
    attachments,
  });
}
