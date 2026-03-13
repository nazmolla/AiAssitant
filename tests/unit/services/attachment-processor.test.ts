import {
  buildScreenFrameParts,
  buildAttachmentParts,
  ATTACHMENTS_DIR,
  MAX_INLINE_TEXT_BYTES,
  MAX_INLINE_IMAGE_BYTES,
  TEXT_MIME_TYPES,
  type AttachmentMeta,
} from "@/lib/services/attachment-processor";
import fs from "fs";
import fsp from "fs/promises";
import pathMod from "path";

/* ── Mocks ─────────────────────────────────────────────────────────── */

jest.mock("fs", () => ({
  existsSync: jest.fn(),
}));

jest.mock("fs/promises", () => ({
  readFile: jest.fn(),
  open: jest.fn(),
}));

/* ── Helpers ───────────────────────────────────────────────────────── */

function att(overrides: Partial<AttachmentMeta> = {}): AttachmentMeta {
  return {
    id: "abc-123",
    filename: "test.txt",
    mimeType: "text/plain",
    sizeBytes: 100,
    storagePath: "thread-1/abc-123.txt",
    ...overrides,
  };
}

/* ── Tests ─────────────────────────────────────────────────────────── */

describe("buildScreenFrameParts", () => {
  it("adds a text message if provided", () => {
    const parts = buildScreenFrameParts([], "Hello");
    expect(parts[0]).toEqual({ type: "text", text: "Hello" });
  });

  it("omits text message when not provided", () => {
    const parts = buildScreenFrameParts([]);
    expect(parts[0]?.type).toBe("text");
    expect((parts[0] as { text: string }).text).toContain("[Screen Share]");
  });

  it("adds image_url parts for valid data URIs", () => {
    const parts = buildScreenFrameParts(["data:image/png;base64,AAAA"]);
    const imageParts = parts.filter((p) => p.type === "image_url");
    expect(imageParts).toHaveLength(1);
    expect((imageParts[0] as { image_url: { url: string } }).image_url.url).toBe(
      "data:image/png;base64,AAAA"
    );
  });

  it("skips non-data-URI frames", () => {
    const parts = buildScreenFrameParts(["https://evil.com/img.png"]);
    const imageParts = parts.filter((p) => p.type === "image_url");
    expect(imageParts).toHaveLength(0);
  });
});

describe("buildAttachmentParts", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("prepends text message when provided", async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fsp.readFile as jest.Mock).mockResolvedValue("content");

    const parts = await buildAttachmentParts([att()], "Hello");
    expect(parts[0]).toEqual({ type: "text", text: "Hello" });
  });

  it("rejects path traversal attempts", async () => {
    const parts = await buildAttachmentParts([
      att({ storagePath: "../../etc/passwd", filename: "evil.txt" }),
    ]);
    expect(parts).toHaveLength(1);
    expect((parts[0] as { text: string }).text).toContain("invalid storage path");
  });

  it("handles missing files", async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const parts = await buildAttachmentParts([att({ filename: "gone.txt" })]);
    expect(parts).toHaveLength(1);
    expect((parts[0] as { text: string }).text).toContain("could not be found on disk");
  });

  /* ── Image processing ───────────────────────────────────────────── */

  it("inlines small images as base64 data URIs", async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const buf = Buffer.from("PNG-DATA");
    (fsp.readFile as jest.Mock).mockResolvedValue(buf);

    const parts = await buildAttachmentParts([
      att({
        mimeType: "image/png",
        sizeBytes: 1000,
        storagePath: "thread-1/img.png",
        filename: "photo.png",
      }),
    ]);

    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("image_url");
    const part = parts[0] as { image_url: { url: string } };
    expect(part.image_url.url).toContain("data:image/png;base64,");
  });

  it("references large images by path instead of inlining", async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const parts = await buildAttachmentParts([
      att({
        mimeType: "image/png",
        sizeBytes: MAX_INLINE_IMAGE_BYTES + 1,
        storagePath: "thread-1/big.png",
        filename: "big.png",
      }),
    ]);

    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("text");
    expect((parts[0] as { text: string }).text).toContain("too large to inline");
  });

  /* ── Text processing ────────────────────────────────────────────── */

  it("inlines small text files", async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fsp.readFile as jest.Mock).mockResolvedValue("file contents here");

    const parts = await buildAttachmentParts([
      att({ mimeType: "text/plain", sizeBytes: 100, filename: "notes.txt" }),
    ]);

    expect(parts).toHaveLength(1);
    expect((parts[0] as { text: string }).text).toContain("file contents here");
  });

  it("previews large text files (first 2 KB)", async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const mockFh = {
      read: jest.fn().mockResolvedValue({ bytesRead: 10 }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (fsp.open as jest.Mock).mockResolvedValue(mockFh);

    const parts = await buildAttachmentParts([
      att({
        mimeType: "text/plain",
        sizeBytes: MAX_INLINE_TEXT_BYTES + 1,
        filename: "huge.txt",
      }),
    ]);

    expect(parts).toHaveLength(1);
    expect((parts[0] as { text: string }).text).toContain("too large to inline fully");
    expect((parts[0] as { text: string }).text).toContain("Preview (first 2 KB)");
    expect(mockFh.close).toHaveBeenCalled();
  });

  /* ── Binary files ───────────────────────────────────────────────── */

  it("references binary files by path", async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const parts = await buildAttachmentParts([
      att({
        mimeType: "application/pdf",
        sizeBytes: 5000,
        storagePath: "thread-1/doc.pdf",
        filename: "report.pdf",
      }),
    ]);

    expect(parts).toHaveLength(1);
    expect((parts[0] as { text: string }).text).toContain("Uploaded file");
    expect((parts[0] as { text: string }).text).toContain("fs_read_file");
  });
});

/* ── Constants smoke tests ─────────────────────────────────────────── */

describe("attachment-processor constants", () => {
  it("ATTACHMENTS_DIR ends with data/attachments", () => {
    expect(ATTACHMENTS_DIR).toContain(pathMod.join("data", "attachments"));
  });

  it("MAX_INLINE_TEXT_BYTES is 512 KB", () => {
    expect(MAX_INLINE_TEXT_BYTES).toBe(512 * 1024);
  });

  it("MAX_INLINE_IMAGE_BYTES is 5 MB", () => {
    expect(MAX_INLINE_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });

  it("TEXT_MIME_TYPES includes expected types", () => {
    expect(TEXT_MIME_TYPES.has("text/plain")).toBe(true);
    expect(TEXT_MIME_TYPES.has("application/json")).toBe(true);
    expect(TEXT_MIME_TYPES.has("image/svg+xml")).toBe(true);
    expect(TEXT_MIME_TYPES.has("application/pdf")).toBe(false);
  });
});
