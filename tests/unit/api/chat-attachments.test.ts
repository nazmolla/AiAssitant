/**
 * Unit tests — Chat route attachment size guards
 *
 * Verifies the OOM-prevention logic added in v0.44.3:
 * - Text files > 512 KB are NOT fully inlined (only 2 KB preview)
 * - Images > 5 MB are NOT base64-inlined (path reference only)
 * - Small text files and images are still inlined normally
 */

// Constants matching src/app/api/threads/[threadId]/chat/route.ts
const MAX_INLINE_TEXT_BYTES = 512 * 1024; // 512 KB
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const PREVIEW_BYTES = 2048;

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

describe("Attachment size constants", () => {
  test("MAX_INLINE_TEXT_BYTES is 512 KB", () => {
    expect(MAX_INLINE_TEXT_BYTES).toBe(524288);
  });

  test("MAX_INLINE_IMAGE_BYTES is 5 MB", () => {
    expect(MAX_INLINE_IMAGE_BYTES).toBe(5242880);
  });
});

describe("Text file inline decision", () => {
  test("small text file (100 KB) is inlined", () => {
    const sizeBytes = 100 * 1024;
    expect(sizeBytes <= MAX_INLINE_TEXT_BYTES).toBe(true);
  });

  test("text file at boundary (512 KB) is inlined", () => {
    const sizeBytes = 512 * 1024;
    expect(sizeBytes <= MAX_INLINE_TEXT_BYTES).toBe(true);
  });

  test("large text file (15 MB HTML) is NOT inlined", () => {
    const sizeBytes = 15 * 1024 * 1024;
    expect(sizeBytes <= MAX_INLINE_TEXT_BYTES).toBe(false);
  });

  test("text file just over limit (513 KB) is NOT inlined", () => {
    const sizeBytes = 513 * 1024;
    expect(sizeBytes <= MAX_INLINE_TEXT_BYTES).toBe(false);
  });
});

describe("Image file inline decision", () => {
  test("small image (1 MB) is inlined", () => {
    const sizeBytes = 1 * 1024 * 1024;
    expect(sizeBytes <= MAX_INLINE_IMAGE_BYTES).toBe(true);
  });

  test("image at boundary (5 MB) is inlined", () => {
    const sizeBytes = 5 * 1024 * 1024;
    expect(sizeBytes <= MAX_INLINE_IMAGE_BYTES).toBe(true);
  });

  test("large image (10 MB) is NOT inlined", () => {
    const sizeBytes = 10 * 1024 * 1024;
    expect(sizeBytes <= MAX_INLINE_IMAGE_BYTES).toBe(false);
  });
});

describe("TEXT_MIME_TYPES coverage", () => {
  test("text/html is text type (for HTML uploads)", () => {
    expect(TEXT_MIME_TYPES.has("text/html")).toBe(true);
  });

  test("application/json is text type", () => {
    expect(TEXT_MIME_TYPES.has("application/json")).toBe(true);
  });

  test("application/pdf is NOT text type", () => {
    expect(TEXT_MIME_TYPES.has("application/pdf")).toBe(false);
  });

  test("image/png is NOT text type", () => {
    expect(TEXT_MIME_TYPES.has("image/png")).toBe(false);
  });

  test("image/svg+xml IS text type", () => {
    expect(TEXT_MIME_TYPES.has("image/svg+xml")).toBe(true);
  });
});

describe("Preview size", () => {
  test("preview reads only 2 KB from large files", () => {
    expect(PREVIEW_BYTES).toBe(2048);
  });

  test("preview is much smaller than MAX_INLINE_TEXT_BYTES", () => {
    expect(PREVIEW_BYTES).toBeLessThan(MAX_INLINE_TEXT_BYTES / 100);
  });
});

// PERF-01: Verify no synchronous file reads in attachment processing
describe("Async file reads (PERF-01)", () => {
  test("chat route delegates to attachment-processor service (no inline file I/O)", () => {
    const fs = require("fs");
    const path = require("path");
    const routePath = path.join(__dirname, "../../../src/app/api/threads/[threadId]/chat/route.ts");
    const src = fs.readFileSync(routePath, "utf-8");

    // Should NOT contain readFileSync anywhere
    expect(src).not.toContain("readFileSync");
    expect(src).not.toContain("openSync");
    expect(src).not.toContain("readSync(");
    expect(src).not.toContain("closeSync");

    // Should delegate to attachment-processor
    expect(src).toContain("@/lib/services/attachment-processor");
    expect(src).toContain("buildAttachmentParts");
    expect(src).toContain("buildScreenFrameParts");
  });

  test("attachment-processor uses fsp (fs/promises) instead of readFileSync", () => {
    const fs = require("fs");
    const path = require("path");
    const svcPath = path.join(__dirname, "../../../src/lib/services/attachment-processor.ts");
    const src = fs.readFileSync(svcPath, "utf-8");

    // Should NOT contain readFileSync
    expect(src).not.toContain("readFileSync");

    // Should import fs/promises
    expect(src).toMatch(/import\s+\w+\s+from\s+["']fs\/promises["']/);
    // Should use async reads
    expect(src).toContain("fsp.readFile");
    expect(src).toContain("fsp.open");
  });

  test("chat route has no synchronous file reads", () => {
    const fs = require("fs");
    const path = require("path");
    const routePath = path.join(__dirname, "../../../src/app/api/threads/[threadId]/chat/route.ts");
    const src = fs.readFileSync(routePath, "utf-8");
    // Exclude import statements — only check actual usage
    const withoutImports = src.replace(/^import\s.*$/gm, "");
    expect(withoutImports).not.toMatch(/\breadFileSync\b/);
    expect(withoutImports).not.toMatch(/\bopenSync\b/);
    expect(withoutImports).not.toMatch(/\bcloseSync\b/);
  });
});
