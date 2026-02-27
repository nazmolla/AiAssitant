import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { addAttachment, getThread } from "@/lib/db";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";

const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "attachments");

const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/bmp",
  "image/tiff",
  "image/x-tiff",
  "image/vnd.adobe.photoshop",
  "image/x-adobe-dng",
  "image/dng",
  // Documents
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Videos
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const ALLOWED_EXTENSIONS = new Set([
  // Images
  ".jpg", ".jpeg", ".jfif", ".png", ".gif", ".webp", ".svg",
  ".heic", ".heif", ".avif", ".bmp", ".tif", ".tiff", ".dng", ".raw",
  // Documents
  ".pdf", ".txt", ".csv", ".md", ".json", ".doc", ".docx", ".xls", ".xlsx",
  // Videos
  ".mp4", ".webm", ".mov",
]);

function isAllowedUpload(file: File): boolean {
  const ext = path.extname(file.name || "").toLowerCase();
  if (ALLOWED_MIME_TYPES.has(file.type)) return true;

  // Some clients (including HEIC/DNG uploads) may send generic mime type.
  if ((file.type === "application/octet-stream" || file.type === "") && ALLOWED_EXTENSIONS.has(ext)) {
    return true;
  }

  return false;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const threadId = formData.get("threadId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!threadId) {
      return NextResponse.json({ error: "threadId is required" }, { status: 400 });
    }
    // Validate threadId is a UUID to prevent path traversal
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(threadId)) {
      return NextResponse.json({ error: "Invalid threadId format" }, { status: 400 });
    }

    // Verify thread ownership — prevent IDOR (uploading to another user's thread)
    const thread = getThread(threadId);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    if (thread.user_id !== auth.user.id && auth.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!isAllowedUpload(file)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type || "unknown"}` },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    const id = uuid();
    const ext = path.extname(file.name) || "";
    const storageName = `${id}${ext}`;
    const threadDir = path.join(ATTACHMENTS_DIR, threadId);

    // Ensure directory exists
    fs.mkdirSync(threadDir, { recursive: true });

    // Write file to disk
    const buffer = Buffer.from(await file.arrayBuffer());
    const storagePath = path.join(threadDir, storageName);
    fs.writeFileSync(storagePath, buffer);

    const meta = {
      id,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      storagePath: `${threadId}/${storageName}`,
    };

    return NextResponse.json(meta);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
