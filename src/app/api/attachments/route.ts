import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { addAttachment, getThread, addLog } from "@/lib/db";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";

const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "attachments");

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const threadId = formData.get("threadId") as string | null;

    if (!file) {
      addLog({ level: "warning", source: "api.attachments", message: "Upload rejected: missing file.", metadata: JSON.stringify({ threadId, userId: auth.user.id }) });
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!threadId) {
      addLog({ level: "warning", source: "api.attachments", message: "Upload rejected: missing threadId.", metadata: JSON.stringify({ fileName: file.name, fileSize: file.size, fileType: file.type, userId: auth.user.id }) });
      return NextResponse.json({ error: "threadId is required" }, { status: 400 });
    }
    // Validate threadId is a UUID to prevent path traversal
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(threadId)) {
      addLog({ level: "warning", source: "api.attachments", message: "Upload rejected: invalid threadId format.", metadata: JSON.stringify({ threadId }) });
      return NextResponse.json({ error: "Invalid threadId format" }, { status: 400 });
    }

    // Verify thread ownership — prevent IDOR (uploading to another user's thread)
    const thread = getThread(threadId);
    if (!thread) {
      addLog({ level: "warning", source: "api.attachments", message: "Upload rejected: thread not found.", metadata: JSON.stringify({ threadId }) });
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    if (thread.user_id !== auth.user.id && auth.user.role !== "admin") {
      addLog({ level: "warning", source: "api.attachments", message: "Upload rejected: forbidden thread access.", metadata: JSON.stringify({ threadId, userId: auth.user.id }) });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (file.size > MAX_FILE_SIZE) {
      addLog({ level: "warning", source: "api.attachments", message: "Upload rejected: file too large.", metadata: JSON.stringify({ size: file.size, max: MAX_FILE_SIZE }) });
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

    addLog({
      level: "verbose",
      source: "api.attachments",
      message: "Attachment uploaded successfully.",
      metadata: JSON.stringify({ threadId, filename: file.name, size: file.size }),
    });

    return NextResponse.json(meta);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog({
      level: "error",
      source: "api.attachments",
      message: "Attachment upload failed.",
      metadata: JSON.stringify({ error: msg }),
    });
    return NextResponse.json({ error: "Attachment upload failed." }, { status: 500 });
  }
}
