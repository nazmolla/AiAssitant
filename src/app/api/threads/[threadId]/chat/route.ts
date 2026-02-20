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
    attachments?: Array<{
      id: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      storagePath: string;
    }>;
    screenFrames?: string[]; // base64 data URIs from screen sharing
  };

  if (
    (!message || typeof message !== "string") &&
    (!attachments || attachments.length === 0) &&
    (!screenFrames || screenFrames.length === 0)
  ) {
    return NextResponse.json({ error: "Message, attachments, or screen frames required" }, { status: 400 });
  }

  // Build content parts for multimodal messages
  let contentParts: ContentPart[] | undefined;

  // Include screen frames as vision content
  if (screenFrames && screenFrames.length > 0) {
    if (!contentParts) contentParts = [];
    if (message) {
      contentParts.push({ type: "text", text: message });
    }
    contentParts.push({
      type: "text",
      text: "[Screen Share] The following image(s) show the user's current screen. Describe what you see and help the user with whatever they are asking about. You can reference specific UI elements, text, and content visible on screen.",
    });
    for (const frame of screenFrames) {
      // Validate it's a data URI
      if (frame.startsWith("data:image/")) {
        contentParts.push({
          type: "image_url",
          image_url: { url: frame, detail: "high" },
        });
      }
    }
  }

  if (attachments && attachments.length > 0) {
    if (!contentParts) contentParts = [];
    if (message && !screenFrames?.length) {
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

function getBaseUrl(_req: NextRequest): string {
  // Use NEXTAUTH_URL to prevent host header injection
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL.replace(/\/$/, "");
  }
  return "http://localhost:3000";
}
