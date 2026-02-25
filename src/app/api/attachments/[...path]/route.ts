import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const ALLOWED_SUBDIRS = ["attachments", "screenshots"];

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const relativePath = params.path.join("/");

  // Only allow known subdirectories (attachments, screenshots)
  const firstSegment = params.path[0];
  if (!ALLOWED_SUBDIRS.includes(firstSegment)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const filePath = path.join(DATA_DIR, relativePath);

  // Prevent directory traversal
  if (!filePath.startsWith(DATA_DIR)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

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
  const safeFilename = path.basename(filePath).replace(/["\r\n]/g, "_");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${safeFilename}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
