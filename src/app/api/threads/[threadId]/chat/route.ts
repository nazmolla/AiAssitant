import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { runAgentLoopWithWorker } from "@/lib/agent";
import { getThread } from "@/lib/db/thread-queries";
import type { ContentPart } from "@/lib/llm";
import { createSSEStream, sseResponse, sseEvent } from "@/lib/sse";
import {
  buildScreenFrameParts,
  buildAttachmentParts,
  type AttachmentMeta,
} from "@/lib/services/attachment-processor";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("api.threads.chat");

/** Prevent Next.js from caching SSE responses */
export const dynamic = "force-dynamic";

type ThreadChatRouteDeps = {
  requireUser: typeof requireUser;
  runAgentLoopWithWorker: typeof runAgentLoopWithWorker;
  getThread: typeof getThread;
};

const deps: ThreadChatRouteDeps = {
  requireUser,
  runAgentLoopWithWorker,
  getThread,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const t0 = Date.now();
  const { threadId } = await params;
  log.enter("POST /api/threads/[threadId]/chat", { threadId });
  const auth = await deps.requireUser();
  if ("error" in auth) return auth.error;

  const thread = deps.getThread(threadId);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  // Ensure user owns this thread
  if (thread.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (thread.status === "awaiting_approval") {
    return NextResponse.json(
      { error: "Thread is awaiting approval. Resolve pending actions first." },
      { status: 409 }
    );
  }

  const body = await req.json();
  const { message, attachments, screenFrames } = body as {
    message?: string;
    attachments?: AttachmentMeta[];
    screenFrames?: string[];
  };

  if (
    (!message || typeof message !== "string") &&
    (!attachments || attachments.length === 0) &&
    (!screenFrames || screenFrames.length === 0)
  ) {
    return NextResponse.json({ error: "Message, attachments, or screen frames required" }, { status: 400 });
  }

  // Build multimodal content parts via extracted service
  let contentParts: ContentPart[] | undefined;

  if (screenFrames && screenFrames.length > 0) {
    contentParts = buildScreenFrameParts(screenFrames, message);
  }

  if (attachments && attachments.length > 0) {
    const attParts = await buildAttachmentParts(
      attachments,
      !screenFrames?.length ? message : undefined
    );
    contentParts = contentParts ? [...contentParts, ...attParts] : attParts;
  }

  // Stream response via SSE
  const sse = createSSEStream();

  // Fire-and-forget: run the agent loop asynchronously, pushing SSE events
  (async () => {
    try {
      const response = await runAgentLoopWithWorker(
        
        threadId,
        message || "(see attached files)",
        contentParts,
        attachments,
        undefined,
        auth.user.id,
        (msg) => { sse.send(sseEvent("message", msg)); },
        (status) => { sse.send(sseEvent("status", status)); },
        async (token) => { sse.send(sseEvent("token", token)); }
      );
      sse.send(sseEvent("done", response));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = errorMsg.split("\n")[0].replace(/\/home\/[^\s]+/g, "[path]").replace(/[A-Z]:[\\/][^\s]+/g, "[path]");
      sse.send(sseEvent("error", { error: safeMsg }));
    } finally {
      sse.close();
    }
  })();

  log.exit("POST /api/threads/[threadId]/chat", { threadId }, Date.now() - t0);
  return sseResponse(sse);
}
