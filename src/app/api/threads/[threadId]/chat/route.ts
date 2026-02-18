import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { runAgentLoop } from "@/lib/agent";
import { getThread } from "@/lib/db";
import type { ContentPart } from "@/lib/llm";

export async function POST(
  req: NextRequest,
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

  if (thread.status === "awaiting_approval") {
    return NextResponse.json(
      { error: "Thread is awaiting approval. Resolve pending actions first." },
      { status: 409 }
    );
  }

  const body = await req.json();
  const { message, attachments } = body as {
    message?: string;
    attachments?: Array<{
      id: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      storagePath: string;
    }>;
  };

  if ((!message || typeof message !== "string") && (!attachments || attachments.length === 0)) {
    return NextResponse.json({ error: "Message or attachments required" }, { status: 400 });
  }

  // Build content parts for multimodal messages
  let contentParts: ContentPart[] | undefined;
  if (attachments && attachments.length > 0) {
    contentParts = [];
    if (message) {
      contentParts.push({ type: "text", text: message });
    }
    for (const att of attachments) {
      if (att.mimeType.startsWith("image/")) {
        contentParts.push({
          type: "image_url",
          image_url: {
            url: `${getBaseUrl(req)}/api/attachments/${att.storagePath}`,
            detail: "auto",
          },
        });
      } else {
        contentParts.push({
          type: "file",
          file: {
            url: `${getBaseUrl(req)}/api/attachments/${att.storagePath}`,
            mimeType: att.mimeType,
            filename: att.filename,
          },
        });
      }
    }
  }

  try {
    const response = await runAgentLoop(
      params.threadId,
      message || "(see attached files)",
      contentParts,
      attachments,
      undefined,
      auth.user.id
    );
    return NextResponse.json(response);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

function getBaseUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}
