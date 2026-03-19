import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getThread, getThreadMessages, deleteThread } from "@/lib/db";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("api.threads.threadId");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const t0 = Date.now();
  const { threadId } = await params;
  log.enter("GET /api/threads/[threadId]", { threadId });
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;

    const thread = getThread(threadId);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    // Ensure user owns this thread
    if (thread.user_id !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const messages = getThreadMessages(threadId);
    log.exit("GET /api/threads/[threadId]", { threadId, messageCount: messages.length }, Date.now() - t0);
    return NextResponse.json({ thread, messages });
  } catch (err) {
    log.error("GET /api/threads/[threadId] failed", { threadId }, err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: "Failed to fetch thread." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const t0 = Date.now();
  const { threadId } = await params;
  log.enter("DELETE /api/threads/[threadId]", { threadId });
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;

    const thread = getThread(threadId);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    if (thread.user_id !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    deleteThread(threadId);
    log.exit("DELETE /api/threads/[threadId]", { threadId }, Date.now() - t0);
    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("DELETE /api/threads/[threadId] failed", { threadId }, err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: "Failed to delete thread." }, { status: 500 });
  }
}
