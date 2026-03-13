import fs from "fs";
import path from "path";
import { executeBuiltinFsTool, FS_TOOL_NAMES } from "@/lib/tools/fs-tools";

describe("fs tools — large file handling", () => {
  const tmpRoot = path.join(process.cwd(), "tmp", "fs-tools-tests");

  beforeAll(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test("fs_read_file rejects full read above 2MB without chunking", async () => {
    const filePath = path.join(tmpRoot, "large-full-read.html");
    const big = "A".repeat(2 * 1024 * 1024 + 128);
    fs.writeFileSync(filePath, big, "utf-8");

    await expect(
      executeBuiltinFsTool(FS_TOOL_NAMES.READ_FILE, { filePath })
    ).rejects.toThrow(/too large/i);
  });

  test("fs_read_file supports byte chunk read above 2MB", async () => {
    const filePath = path.join(tmpRoot, "large-chunk-read.html");
    const content = "HEADER-" + "B".repeat(2 * 1024 * 1024 + 1024);
    fs.writeFileSync(filePath, content, "utf-8");

    const result = (await executeBuiltinFsTool(FS_TOOL_NAMES.READ_FILE, {
      filePath,
      offset: 0,
      length: 64,
    })) as { content: string; bytesRead: number; hasMore: boolean };

    expect(result.bytesRead).toBe(64);
    expect(result.content.startsWith("HEADER-")).toBe(true);
    expect(result.hasMore).toBe(true);
  });

  test("fs_extract_text strips HTML/script/style noise", async () => {
    const filePath = path.join(tmpRoot, "sample.html");
    fs.writeFileSync(
      filePath,
      `<!doctype html><html><head><style>.x{display:none}</style></head><body><script>danger()</script><h1>Hello &amp; Welcome</h1><p>Line 1</p><p>Line 2</p></body></html>`,
      "utf-8"
    );

    const result = (await executeBuiltinFsTool(FS_TOOL_NAMES.EXTRACT_TEXT, {
      filePath,
      maxChars: 200,
    })) as { text: string; extractedChars: number };

    expect(result.text).toContain("Hello & Welcome");
    expect(result.text).toContain("Line 1");
    expect(result.text).toContain("Line 2");
    expect(result.text).not.toContain("danger()");
    expect(result.extractedChars).toBeGreaterThan(0);
  });
});
