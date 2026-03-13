/**
 * Attachment + screen-frame processing service.
 *
 * Extracts the multimodal `ContentPart[]` construction that was
 * previously inline in the chat route POST handler.
 */

import fs from "fs";
import fsp from "fs/promises";
import pathMod from "path";
import type { ContentPart } from "@/lib/llm";

/* ── Constants ─────────────────────────────────────────────────────── */

export const ATTACHMENTS_DIR = pathMod.join(process.cwd(), "data", "attachments");

/** Max text file size (bytes) to inline directly; larger files are referenced by path */
export const MAX_INLINE_TEXT_BYTES = 512 * 1024; // 512 KB

/** Max image file size (bytes) to inline as base64; larger images are referenced by path */
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Text preview size for large text files */
const TEXT_PREVIEW_BYTES = 2048;

/** MIME types we can read as UTF-8 text and pass directly to the LLM */
export const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "text/xml",
  "application/json",
  "application/xml",
  "image/svg+xml",
]);

/* ── Types ─────────────────────────────────────────────────────────── */

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

/* ── Screen frames ─────────────────────────────────────────────────── */

/**
 * Convert base64 screen-share data URIs into vision-capable `ContentPart[]`.
 */
export function buildScreenFrameParts(
  screenFrames: string[],
  message?: string
): ContentPart[] {
  const parts: ContentPart[] = [];

  if (message) {
    parts.push({ type: "text", text: message });
  }

  parts.push({
    type: "text",
    text: "[Screen Share] The following image(s) show the user's current screen. Describe what you see and help the user with whatever they are asking about. You can reference specific UI elements, text, and content visible on screen.",
  });

  for (const frame of screenFrames) {
    if (frame.startsWith("data:image/")) {
      parts.push({
        type: "image_url",
        image_url: { url: frame, detail: "high" },
      });
    }
  }

  return parts;
}

/* ── Attachment files ──────────────────────────────────────────────── */

/**
 * Process a list of attachment metadata into multimodal `ContentPart[]`.
 *
 * Each attachment is resolved from disk and either:
 *   - inlined (image → base64 data URI, text → raw content), or
 *   - referenced by absolute path for large / binary files.
 *
 * Path traversal protection is built-in.
 */
export async function buildAttachmentParts(
  attachments: AttachmentMeta[],
  message?: string
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];

  if (message) {
    parts.push({ type: "text", text: message });
  }

  const resolvedBase = pathMod.resolve(ATTACHMENTS_DIR) + pathMod.sep;

  for (const att of attachments) {
    const filePath = pathMod.join(ATTACHMENTS_DIR, att.storagePath);
    const resolvedPath = pathMod.resolve(filePath);

    // Prevent path traversal
    if (!resolvedPath.startsWith(resolvedBase)) {
      parts.push({
        type: "text",
        text: `📎 File "${att.filename}" has an invalid storage path.`,
      });
      continue;
    }

    const fileExists = fs.existsSync(filePath);

    if (att.mimeType.startsWith("image/") && fileExists) {
      parts.push(await processImage(att, filePath));
    } else if (TEXT_MIME_TYPES.has(att.mimeType) && fileExists) {
      parts.push(await processText(att, filePath));
    } else if (fileExists) {
      parts.push(processBinary(att, filePath));
    } else {
      parts.push({
        type: "text",
        text: `📎 File "${att.filename}" was uploaded but could not be found on disk.`,
      });
    }
  }

  return parts;
}

/* ── Internal helpers ──────────────────────────────────────────────── */

async function processImage(
  att: AttachmentMeta,
  filePath: string
): Promise<ContentPart> {
  if (att.sizeBytes <= MAX_INLINE_IMAGE_BYTES) {
    const buf = await fsp.readFile(filePath);
    const b64 = buf.toString("base64");
    const dataUri = `data:${att.mimeType};base64,${b64}`;
    return {
      type: "image_url",
      image_url: { url: dataUri, detail: "auto" },
    };
  }

  const absPath = pathMod.resolve(filePath);
  return {
    type: "text",
    text: `📎 Image: "${att.filename}" (${att.mimeType}, ${(att.sizeBytes / 1024 / 1024).toFixed(1)} MB — too large to inline)\nStored at: ${absPath}\nUse the fs_read_file tool with this path to access the image.`,
  };
}

async function processText(
  att: AttachmentMeta,
  filePath: string
): Promise<ContentPart> {
  if (att.sizeBytes <= MAX_INLINE_TEXT_BYTES) {
    const textContent = await fsp.readFile(filePath, "utf-8");
    return {
      type: "text",
      text: `📎 File: ${att.filename}\n\`\`\`\n${textContent}\n\`\`\``,
    };
  }

  // Large text file — inline a preview, reference the full file by path
  const fh = await fsp.open(filePath, "r");
  const buf = Buffer.alloc(TEXT_PREVIEW_BYTES);
  const { bytesRead } = await fh.read(buf, 0, TEXT_PREVIEW_BYTES, 0);
  await fh.close();
  const preview = buf.toString("utf-8", 0, bytesRead);
  const absPath = pathMod.resolve(filePath);
  return {
    type: "text",
    text: `📎 File: "${att.filename}" (${att.mimeType}, ${(att.sizeBytes / 1024).toFixed(0)} KB — too large to inline fully)\nPreview (first 2 KB):\n\`\`\`\n${preview}\n\`\`\`\nFull file stored at: ${absPath}\nUse the fs_read_file tool with this path to read more content.`,
  };
}

function processBinary(att: AttachmentMeta, filePath: string): ContentPart {
  const absPath = pathMod.resolve(filePath);
  return {
    type: "text",
    text: `📎 Uploaded file: "${att.filename}" (${att.mimeType}, ${att.sizeBytes} bytes)\nStored at: ${absPath}\nUse the fs_read_file tool with this path to read the file contents.`,
  };
}
