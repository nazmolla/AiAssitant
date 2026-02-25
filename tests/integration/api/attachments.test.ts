/**
 * Integration tests — Attachments API
 *
 * Tests:
 * - POST /api/attachments: file upload, validation, storage
 * - GET /api/attachments/[...path]: serving files with and without subdir prefix
 * - Chat with attachments: images → base64 data URI, text files → inline content,
 *   binary docs → file path instruction
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

// Mock the agent loop
jest.mock("@/lib/agent", () => ({
  runAgentLoop: jest.fn(async (_tid: string, msg: string, contentParts: any) => ({
    content: `Echo: ${msg}`,
    toolsUsed: [],
    pendingApprovals: [],
    attachments: [],
    _testContentParts: contentParts, // expose for test inspection
  })),
}));

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { POST as uploadAttachment } from "@/app/api/attachments/route";
import { GET as serveAttachment } from "@/app/api/attachments/[...path]/route";
import { POST as postChat } from "@/app/api/threads/[threadId]/chat/route";
import { createThread } from "@/lib/db/queries";
import { runAgentLoop } from "@/lib/agent";
import fs from "fs";
import path from "path";

const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "attachments");

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "attach@test.com", role: "user" });
});
afterAll(() => {
  teardownTestDb();
  // Cleanup test files
  const testDir = path.join(ATTACHMENTS_DIR, "__test__");
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }
});

describe("POST /api/attachments — upload", () => {
  let threadId: string;

  beforeEach(() => {
    const thread = createThread("Upload Test", userId);
    threadId = thread.id;
    setMockUser({ id: userId, email: "attach@test.com", role: "user" });
  });

  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const form = new FormData();
    form.append("file", new Blob(["hello"], { type: "text/plain" }), "test.txt");
    form.append("threadId", threadId);

    const req = new NextRequest("http://localhost/api/attachments", {
      method: "POST",
      body: form,
    });
    const res = await uploadAttachment(req);
    expect(res.status).toBe(401);
  });

  test("returns 400 without file", async () => {
    const form = new FormData();
    form.append("threadId", threadId);

    const req = new NextRequest("http://localhost/api/attachments", {
      method: "POST",
      body: form,
    });
    const res = await uploadAttachment(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 without threadId", async () => {
    const form = new FormData();
    form.append("file", new Blob(["hello"], { type: "text/plain" }), "test.txt");

    const req = new NextRequest("http://localhost/api/attachments", {
      method: "POST",
      body: form,
    });
    const res = await uploadAttachment(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid threadId format", async () => {
    const form = new FormData();
    form.append("file", new Blob(["hello"], { type: "text/plain" }), "test.txt");
    form.append("threadId", "../etc/passwd");

    const req = new NextRequest("http://localhost/api/attachments", {
      method: "POST",
      body: form,
    });
    const res = await uploadAttachment(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 for unsupported mime type", async () => {
    const form = new FormData();
    form.append("file", new Blob(["data"], { type: "application/x-executable" }), "malware.exe");
    form.append("threadId", threadId);

    const req = new NextRequest("http://localhost/api/attachments", {
      method: "POST",
      body: form,
    });
    const res = await uploadAttachment(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Unsupported");
  });

  test("uploads a text file successfully", async () => {
    const content = "Hello, World!";
    const form = new FormData();
    form.append("file", new Blob([content], { type: "text/plain" }), "hello.txt");
    form.append("threadId", threadId);

    const req = new NextRequest("http://localhost/api/attachments", {
      method: "POST",
      body: form,
    });
    const res = await uploadAttachment(req);
    expect(res.status).toBe(200);

    const meta = await res.json();
    expect(meta.id).toBeDefined();
    expect(meta.filename).toBe("hello.txt");
    expect(meta.mimeType).toBe("text/plain");
    expect(meta.storagePath).toMatch(new RegExp(`^${threadId}/`));

    // Verify file was written
    const filePath = path.join(ATTACHMENTS_DIR, meta.storagePath);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe(content);
  });

  test("uploads an image file successfully", async () => {
    // Create a minimal 1x1 PNG
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    ]);
    const form = new FormData();
    form.append("file", new Blob([pngHeader], { type: "image/png" }), "photo.png");
    form.append("threadId", threadId);

    const req = new NextRequest("http://localhost/api/attachments", {
      method: "POST",
      body: form,
    });
    const res = await uploadAttachment(req);
    expect(res.status).toBe(200);
    const meta = await res.json();
    expect(meta.mimeType).toBe("image/png");
    expect(meta.filename).toBe("photo.png");
  });
});

describe("GET /api/attachments/[...path] — serve files", () => {
  let storagePath: string;

  beforeAll(() => {
    setMockUser({ id: userId, email: "attach@test.com", role: "user" });

    // Create a test file directly on disk
    const testDir = path.join(ATTACHMENTS_DIR, "__test__");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, "sample.txt"), "test content");
    storagePath = "__test__/sample.txt";
  });

  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const req = new NextRequest("http://localhost/api/attachments/__test__/sample.txt");
    const res = await serveAttachment(req, { params: { path: ["__test__", "sample.txt"] } });
    expect(res.status).toBe(401);
  });

  test("serves file with 'attachments' prefix in path", async () => {
    setMockUser({ id: userId, email: "attach@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/attachments/attachments/__test__/sample.txt");
    const res = await serveAttachment(req, { params: { path: ["attachments", "__test__", "sample.txt"] } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("test content");
  });

  test("serves file WITHOUT 'attachments' prefix (threadId-style path)", async () => {
    setMockUser({ id: userId, email: "attach@test.com", role: "user" });
    // This is the path format that storagePath uses: {threadId}/{filename}
    const req = new NextRequest("http://localhost/api/attachments/__test__/sample.txt");
    const res = await serveAttachment(req, { params: { path: ["__test__", "sample.txt"] } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("test content");
  });

  test("serves screenshots with 'screenshots' prefix", async () => {
    const screenshotsDir = path.join(process.cwd(), "data", "screenshots");
    fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.writeFileSync(path.join(screenshotsDir, "test-shot.png"), "fake-png");

    setMockUser({ id: userId, email: "attach@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/attachments/screenshots/test-shot.png");
    const res = await serveAttachment(req, { params: { path: ["screenshots", "test-shot.png"] } });
    expect(res.status).toBe(200);

    // Cleanup
    fs.unlinkSync(path.join(screenshotsDir, "test-shot.png"));
  });

  test("returns 404 for non-existent file", async () => {
    setMockUser({ id: userId, email: "attach@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/attachments/__test__/no-such-file.txt");
    const res = await serveAttachment(req, { params: { path: ["__test__", "no-such-file.txt"] } });
    expect(res.status).toBe(404);
  });

  test("prevents directory traversal", async () => {
    setMockUser({ id: userId, email: "attach@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/attachments/../../etc/passwd");
    const res = await serveAttachment(req, { params: { path: ["..", "..", "etc", "passwd"] } });
    // Should either 403 or 404 — not serve a system file
    expect([403, 404]).toContain(res.status);
  });
});

describe("Chat with attachments — content part building", () => {
  let threadId: string;

  beforeEach(() => {
    const thread = createThread("Attachment Chat", userId);
    threadId = thread.id;
    setMockUser({ id: userId, email: "attach@test.com", role: "user" });
    (runAgentLoop as jest.Mock).mockClear();
    (runAgentLoop as jest.Mock).mockImplementation(
      async (_tid: string, msg: string, contentParts: any) => ({
        content: `Echo: ${msg}`,
        toolsUsed: [],
        pendingApprovals: [],
        attachments: [],
        _testContentParts: contentParts,
      })
    );
  });

  test("image attachment is converted to base64 data URI", async () => {
    // Create a test image on disk
    const imageData = Buffer.from("fake-png-data");
    const storagePath = `${threadId}/test-image.png`;
    const filePath = path.join(ATTACHMENTS_DIR, storagePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, imageData);

    const req = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({
        message: "What's in this image?",
        attachments: [
          {
            id: "att-1",
            filename: "test-image.png",
            mimeType: "image/png",
            sizeBytes: imageData.length,
            storagePath,
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postChat(req, { params: { threadId } });
    expect(res.status).toBe(200);

    // Verify runAgentLoop was called with base64 data URI content parts
    const call = (runAgentLoop as jest.Mock).mock.calls[0];
    const parts = call[2]; // contentParts argument
    expect(parts).toBeDefined();

    const imagePart = parts.find((p: any) => p.type === "image_url");
    expect(imagePart).toBeDefined();
    expect(imagePart.image_url.url).toMatch(/^data:image\/png;base64,/);

    // Verify it's correct base64
    const b64 = imagePart.image_url.url.replace("data:image/png;base64,", "");
    expect(Buffer.from(b64, "base64").toString()).toBe("fake-png-data");

    // Cleanup
    fs.rmSync(path.join(ATTACHMENTS_DIR, threadId), { recursive: true });
  });

  test("text file attachment is read and included inline", async () => {
    const textContent = "Hello, this is a test file.\nLine 2.";
    const storagePath = `${threadId}/readme.txt`;
    const filePath = path.join(ATTACHMENTS_DIR, storagePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, textContent);

    const req = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({
        message: "Read this file",
        attachments: [
          {
            id: "att-2",
            filename: "readme.txt",
            mimeType: "text/plain",
            sizeBytes: textContent.length,
            storagePath,
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postChat(req, { params: { threadId } });
    expect(res.status).toBe(200);

    const call = (runAgentLoop as jest.Mock).mock.calls[0];
    const parts = call[2];
    expect(parts).toBeDefined();

    // Should have text message + file content
    const filePart = parts.find((p: any) => p.type === "text" && p.text.includes("readme.txt"));
    expect(filePart).toBeDefined();
    expect(filePart.text).toContain(textContent);

    fs.rmSync(path.join(ATTACHMENTS_DIR, threadId), { recursive: true });
  });

  test("JSON file attachment is read and included inline", async () => {
    const jsonContent = JSON.stringify({ key: "value", nested: { a: 1 } });
    const storagePath = `${threadId}/data.json`;
    const filePath = path.join(ATTACHMENTS_DIR, storagePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, jsonContent);

    const req = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({
        message: "Parse this JSON",
        attachments: [
          {
            id: "att-3",
            filename: "data.json",
            mimeType: "application/json",
            sizeBytes: jsonContent.length,
            storagePath,
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postChat(req, { params: { threadId } });
    expect(res.status).toBe(200);

    const call = (runAgentLoop as jest.Mock).mock.calls[0];
    const parts = call[2];
    const filePart = parts.find((p: any) => p.type === "text" && p.text.includes("data.json"));
    expect(filePart).toBeDefined();
    expect(filePart.text).toContain('"key"');

    fs.rmSync(path.join(ATTACHMENTS_DIR, threadId), { recursive: true });
  });

  test("binary document (.docx) provides file path for agent to use", async () => {
    const binaryContent = Buffer.from("PK\x03\x04fake-docx");
    const storagePath = `${threadId}/report.docx`;
    const filePath = path.join(ATTACHMENTS_DIR, storagePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, binaryContent);

    const req = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({
        message: "Read this document",
        attachments: [
          {
            id: "att-4",
            filename: "report.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: binaryContent.length,
            storagePath,
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postChat(req, { params: { threadId } });
    expect(res.status).toBe(200);

    const call = (runAgentLoop as jest.Mock).mock.calls[0];
    const parts = call[2];
    const filePart = parts.find((p: any) => p.type === "text" && p.text.includes("report.docx"));
    expect(filePart).toBeDefined();
    expect(filePart.text).toContain("fs_read_file");
    expect(filePart.text).toContain(path.resolve(filePath));

    fs.rmSync(path.join(ATTACHMENTS_DIR, threadId), { recursive: true });
  });

  test("missing file on disk produces error content part", async () => {
    const storagePath = `${threadId}/gone.txt`;
    // Don't create the file — it's "missing"

    const req = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({
        message: "Where is this?",
        attachments: [
          {
            id: "att-5",
            filename: "gone.txt",
            mimeType: "text/plain",
            sizeBytes: 100,
            storagePath,
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postChat(req, { params: { threadId } });
    expect(res.status).toBe(200);

    const call = (runAgentLoop as jest.Mock).mock.calls[0];
    const parts = call[2];
    const filePart = parts.find((p: any) => p.type === "text" && p.text.includes("could not be found"));
    expect(filePart).toBeDefined();
  });

  test("CSV file is treated as text and included inline", async () => {
    const csvContent = "name,age\nAlice,30\nBob,25";
    const storagePath = `${threadId}/people.csv`;
    const filePath = path.join(ATTACHMENTS_DIR, storagePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, csvContent);

    const req = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({
        message: "Analyze this data",
        attachments: [
          {
            id: "att-6",
            filename: "people.csv",
            mimeType: "text/csv",
            sizeBytes: csvContent.length,
            storagePath,
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postChat(req, { params: { threadId } });
    expect(res.status).toBe(200);

    const call = (runAgentLoop as jest.Mock).mock.calls[0];
    const parts = call[2];
    const filePart = parts.find((p: any) => p.type === "text" && p.text.includes("people.csv"));
    expect(filePart).toBeDefined();
    expect(filePart.text).toContain("Alice,30");

    fs.rmSync(path.join(ATTACHMENTS_DIR, threadId), { recursive: true });
  });
});
