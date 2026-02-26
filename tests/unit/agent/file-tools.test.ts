import fs from "fs";
import path from "path";
import { executeBuiltinFileTool } from "@/lib/agent/file-tools";

describe("file tools", () => {
  const threadId = "thread-test-file-tools";
  const threadDir = path.join(process.cwd(), "data", "attachments", threadId);

  afterEach(() => {
    try {
      fs.rmSync(threadDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test("accepts file_generate alias", async () => {
    const result = await executeBuiltinFileTool(
      "file_generate",
      {
        filename: "alias-test",
        format: "txt",
        content: "hello",
      },
      { threadId }
    ) as { status: string; attachments: Array<{ storagePath: string }> };

    expect(result.status).toBe("created");
    expect(result.attachments).toHaveLength(1);
    const createdPath = path.join(process.cwd(), "data", "attachments", result.attachments[0].storagePath);
    expect(fs.existsSync(createdPath)).toBe(true);
  });

  test("pdf generation tolerates non-breaking hyphen text", async () => {
    await expect(
      executeBuiltinFileTool(
        "builtin.file_generate",
        {
          filename: "unicode-pdf",
          format: "pdf",
          content: "Proactive‑notification with non-breaking hyphen",
        },
        { threadId }
      )
    ).resolves.toBeDefined();
  });
});
