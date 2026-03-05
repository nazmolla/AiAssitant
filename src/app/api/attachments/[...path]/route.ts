import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getThread } from "@/lib/db";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const ALLOWED_SUBDIRS = ["attachments", "screenshots"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const relativePath = pathSegments.join("/");

  // Only allow known subdirectories (attachments, screenshots)
  const firstSegment = pathSegments[0];
  let resolvedPath: string;

  if (ALLOWED_SUBDIRS.includes(firstSegment)) {
    // URL already includes the subdir, e.g. /api/attachments/attachments/{threadId}/{file}
    resolvedPath = path.join(DATA_DIR, relativePath);
  } else {
    // URL omits the subdir, e.g. /api/attachments/{threadId}/{file}
    // Default to "attachments" subdir
    resolvedPath = path.join(DATA_DIR, "attachments", relativePath);
  }

  // Prevent directory traversal
  if (!resolvedPath.startsWith(DATA_DIR)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify thread ownership — prevent IDOR (reading another user's attachments)
  // The thread ID is the first path segment after the optional subdir prefix
  const ownershipSegments = ALLOWED_SUBDIRS.includes(firstSegment) ? pathSegments.slice(1) : pathSegments;
  const threadIdSegment = ownershipSegments[0];
  if (threadIdSegment) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (UUID_RE.test(threadIdSegment)) {
      const thread = getThread(threadIdSegment);
      if (thread && thread.user_id !== auth.user.id && auth.user.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  if (!fs.existsSync(resolvedPath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = fs.readFileSync(resolvedPath);
  const ext = path.extname(resolvedPath).toLowerCase();

  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".md": "text/markdown",
    ".json": "application/json",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };

  const contentType = mimeMap[ext] || "application/octet-stream";

  // Sanitize filename for Content-Disposition header to prevent header injection
  const safeFilename = path.basename(resolvedPath).replace(/["\r\n]/g, "_");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${safeFilename}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
