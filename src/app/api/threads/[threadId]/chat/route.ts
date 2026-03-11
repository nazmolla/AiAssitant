import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { runAgentLoopWithWorker } from "@/lib/agent";
import { getThread } from "@/lib/db";
import type { ContentPart } from "@/lib/llm";
import fs from "fs";
import fsp from "fs/promises";
import pathMod from "path";

/** Prevent Next.js from caching SSE responses */
export const dynamic = "force-dynamic";

const ATTACHMENTS_DIR = pathMod.join(process.cwd(), "data", "attachments");

/** Max text file size (bytes) to inline directly; larger files are referenced by path */
const MAX_INLINE_TEXT_BYTES = 512 * 1024; // 512 KB
/** Max image file size (bytes) to inline as base64; larger images are referenced by path */
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/** MIME types we can read as UTF-8 text and pass directly to the LLM */
const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "text/xml",
  "application/json",
  "application/xml",
  "image/svg+xml",
]);

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
      const filePath = pathMod.join(ATTACHMENTS_DIR, att.storagePath);
      // Prevent path traversal: ensure resolved path stays within ATTACHMENTS_DIR
      const resolvedPath = pathMod.resolve(filePath);
      // Guard with separator to prevent prefix-confusion (e.g. ATTACHMENTS_DIR + ".evil/")
      if (!resolvedPath.startsWith(pathMod.resolve(ATTACHMENTS_DIR) + pathMod.sep)) {
        contentParts.push({ type: "text", text: `📎 File "${att.filename}" has an invalid storage path.` });
        continue;
      }
      const fileExists = fs.existsSync(filePath);

      if (att.mimeType.startsWith("image/") && fileExists) {
        if (att.sizeBytes <= MAX_INLINE_IMAGE_BYTES) {
          // Read image from disk → base64 data URI (LLM can't fetch private network URLs)
          const buf = await fsp.readFile(filePath);
          const b64 = buf.toString("base64");
          const dataUri = `data:${att.mimeType};base64,${b64}`;
          contentParts.push({
            type: "image_url",
            image_url: { url: dataUri, detail: "auto" },
          });
        } else {
          // Image too large to inline — let the agent read it via tool
          const absPath = pathMod.resolve(filePath);
          contentParts.push({
            type: "text",
            text: `📎 Image: "${att.filename}" (${att.mimeType}, ${(att.sizeBytes / 1024 / 1024).toFixed(1)} MB — too large to inline)\nStored at: ${absPath}\nUse the fs_read_file tool with this path to access the image.`,
          });
        }
      } else if (TEXT_MIME_TYPES.has(att.mimeType) && fileExists) {
        if (att.sizeBytes <= MAX_INLINE_TEXT_BYTES) {
          // Text-based file: read content and pass directly to LLM
          const textContent = await fsp.readFile(filePath, "utf-8");
          contentParts.push({
            type: "text",
            text: `📎 File: ${att.filename}\n\`\`\`\n${textContent}\n\`\`\``,
          });
        } else {
          // Large text file — inline a preview, reference the full file by path
          const fh = await fsp.open(filePath, "r");
          const buf = Buffer.alloc(2048);
          const { bytesRead } = await fh.read(buf, 0, 2048, 0);
          await fh.close();
          const preview = buf.toString("utf-8", 0, bytesRead);
          const absPath = pathMod.resolve(filePath);
          contentParts.push({
            type: "text",
            text: `📎 File: "${att.filename}" (${att.mimeType}, ${(att.sizeBytes / 1024).toFixed(0)} KB — too large to inline fully)\nPreview (first 2 KB):\n\`\`\`\n${preview}\n\`\`\`\nFull file stored at: ${absPath}\nUse the fs_read_file tool with this path to read more content.`,
          });
        }
      } else if (fileExists) {
        // Binary document (.docx, .pdf, .xlsx, etc.): tell the agent where it is on disk
        const absPath = pathMod.resolve(filePath);
        contentParts.push({
          type: "text",
          text: `📎 Uploaded file: "${att.filename}" (${att.mimeType}, ${att.sizeBytes} bytes)\nStored at: ${absPath}\nUse the fs_read_file tool with this path to read the file contents.`,
        });
      } else {
        // File missing from disk
        contentParts.push({
          type: "text",
          text: `📎 File "${att.filename}" was uploaded but could not be found on disk.`,
        });
      }
    }
  }

  try {
    // Stream messages via SSE as the agent loop progresses.
    // Use ReadableStream with controller.enqueue() — this pushes data
    // synchronously to the readable side so it flushes immediately to the
    // HTTP response without the internal buffering that TransformStream has.
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let streamCancelled = false;

    /** Safely write to the SSE stream — no-ops if the client has disconnected */
    const sseSend = (text: string): void => {
      if (streamCancelled) return;
      try {
        controller.enqueue(encoder.encode(text));
      } catch {
        streamCancelled = true;
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        // Send an SSE comment as the first byte to force the HTTP layer
        // to flush headers + body immediately (avoids proxy/framework buffering).
        sseSend(": stream opened\n\n");
      },
      cancel() {
        // Client disconnected (tab closed, navigated away, new instance opened)
        streamCancelled = true;
      },
    });

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
          (msg) => {
            sseSend(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
          },
          (status) => {
            sseSend(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
          },
          async (token) => {
            sseSend(`event: token\ndata: ${JSON.stringify(token)}\n\n`);
          }
        );
        sseSend(`event: done\ndata: ${JSON.stringify(response)}\n\n`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const safeMsg = errorMsg.split("\n")[0].replace(/\/home\/[^\s]+/g, "[path]").replace(/[A-Z]:[\\/][^\s]+/g, "[path]");
        sseSend(`event: error\ndata: ${JSON.stringify({ error: safeMsg })}\n\n`);
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    })();

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const safeMsg = errorMsg.split("\n")[0].replace(/\/home\/[^\s]+/g, "[path]").replace(/[A-Z]:[\\/][^\s]+/g, "[path]");
    return NextResponse.json({ error: safeMsg }, { status: 500 });
  }
}
