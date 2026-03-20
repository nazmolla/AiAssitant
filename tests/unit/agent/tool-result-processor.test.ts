/**
 * Unit tests — tool-result-processor.ts
 *
 * Focuses on the remote MCP screenshot fallback (#228):
 * when screenshotPath is a remote path that cannot be stat'd locally,
 * the processor should extract the base64 ImageContent from the MCP
 * content array, save it locally, and build a valid attachment.
 */

import path from "path";

// ── Mocks ────────────────────────────────────────────────────────────

const mockMkdirSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockStatSync = jest.fn();

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

jest.mock("@/lib/db", () => ({
  addMessage: jest.fn().mockReturnValue({ id: "msg-1", thread_id: "t1", role: "tool", content: "" }),
  addAttachment: jest.fn(),
  addLog: jest.fn(),
}));

jest.mock("@/lib/logging/logger", () => ({
  createLogger: () => ({
    enter: jest.fn(),
    exit: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock("@/lib/agent/system-prompt", () => ({
  isUntrustedToolOutput: jest.fn().mockReturnValue(false),
}));

jest.mock("@/lib/constants", () => ({
  TOOL_RESULT_TRUNCATION_LIMIT: 100_000,
}));

import { processExecutedToolResult } from "@/lib/agent/tool-result-processor";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Remote MCP screenshot fallback (#228)", () => {
  const threadId = "thread-1";
  const toolCall = { id: "tc-1", name: "windows_control.screenshot", arguments: {} };

  test("saves base64 image locally when screenshotPath is a remote Windows path", async () => {
    // fs.statSync throws for a Windows path not on this machine
    mockStatSync.mockImplementation(() => { throw new Error("ENOENT"); });

    const base64Png = Buffer.from("fake-png-bytes").toString("base64");
    const mcpResult = {
      screenshotPath: "C:\\Users\\User\\AppData\\Local\\Temp\\screenshot.png",
      content: [
        { type: "text", text: "Screenshot taken" },
        { type: "image", data: base64Png, mimeType: "image/png" },
      ],
    };

    const result = processExecutedToolResult(toolCall, mcpResult, threadId);

    // Should have saved the image locally
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("screenshots"),
      { recursive: true }
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("mcp-screenshot-"),
      expect.any(Buffer)
    );

    // Attachment should be present with correct storagePath
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].storagePath).toMatch(/^screenshots\/mcp-screenshot-/);
    expect(result.attachments[0].mimeType).toBe("image/png");
    expect(result.attachments[0].sizeBytes).toBeGreaterThan(0);
  });

  test("uses local file when statSync succeeds (normal local MCP path)", () => {
    mockStatSync.mockReturnValue({ size: 12345 });

    const mcpResult = {
      screenshotPath: "data/screenshots/local-screenshot.png",
      relativePath: "screenshots/local-screenshot.png",
      content: [
        { type: "image", data: "base64...", mimeType: "image/png" },
      ],
    };

    const result = processExecutedToolResult(toolCall, mcpResult, threadId);

    // Should NOT have written a new file (file found locally)
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].sizeBytes).toBe(12345);
  });

  test("does not crash when screenshotPath is remote and no image content available", () => {
    mockStatSync.mockImplementation(() => { throw new Error("ENOENT"); });

    const mcpResult = {
      screenshotPath: "C:\\bad\\path.png",
      content: [{ type: "text", text: "no image content" }],
    };

    // Should not throw; base64 save is skipped (no image content); writeFileSync not called
    expect(() => processExecutedToolResult(toolCall, mcpResult, threadId)).not.toThrow();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  test("non-screenshot MCP tools are not affected", () => {
    mockStatSync.mockImplementation(() => { throw new Error("ENOENT"); });

    const nonScreenshotTool = { id: "tc-2", name: "windows_control.click", arguments: { x: 100, y: 200 } };
    const plainResult = { status: "clicked", x: 100, y: 200 };

    const result = processExecutedToolResult(nonScreenshotTool, plainResult, threadId);

    expect(result.attachments).toHaveLength(0);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
