import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { runAgentLoopWithWorker } from "@/lib/agent";
import { createThread, getThread } from "@/lib/db/thread-queries";
import { createSSEStream, sseResponse, sseEvent } from "@/lib/sse";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("api.conversation.respond");

/**
 * POST /api/conversation/respond
 *
 * Voice conversation endpoint that now persists to a thread in the database.
 * On the first call (no threadId), a new thread is created and its ID is returned
 * in the SSE `done` event so the client can resume the same conversation.
 *
 * Uses the full agent loop (runAgentLoopWithWorker) — same as the thread chat
 * route — giving voice sessions access to knowledge retrieval, profile context,
 * tool execution, and title auto-generation. History is loaded from the DB
 * rather than being maintained in client memory.
 *
 * Accepts: { message: string, threadId?: string }
 * Returns: SSE stream with `token`, `status`, `message`, `done`, and `error` events.
 * The `done` event payload includes `threadId` so the client can continue the session.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  log.enter("POST /api/conversation/respond");
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  let parsed: { message?: string; threadId?: string };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, threadId: incomingThreadId } = parsed;

  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // Resolve or create thread
  let threadId: string;

  if (incomingThreadId) {
    const thread = getThread(incomingThreadId);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    if (thread.user_id !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    threadId = incomingThreadId;
  } else {
    const thread = createThread("Voice Conversation", auth.user.id);
    threadId = thread.id;
  }

  const sse = createSSEStream();

  (async () => {
    try {
      const response = await runAgentLoopWithWorker(
        threadId,
        message.trim(),
        undefined,
        undefined,
        undefined,
        auth.user.id,
        (msg) => { sse.send(sseEvent("message", msg)); },
        (status) => { sse.send(sseEvent("status", status)); },
        async (token) => { sse.send(sseEvent("token", token)); }
      );
      sse.send(sseEvent("done", { ...response, threadId }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = errorMsg.split("\n")[0].replace(/[A-Z]:[\\/][^\s]+/g, "[path]");
      sse.send(sseEvent("error", { error: safeMsg }));
    } finally {
      sse.close();
    }
  })();

  log.exit("POST /api/conversation/respond", { userId: auth.user.id, threadId }, Date.now() - t0);
  return sseResponse(sse);
}
