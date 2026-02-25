/**
 * Integration tests — Chat API (/api/threads/[threadId]/chat)
 *
 * Tests the chat endpoint: auth, ownership, awaiting_approval guard,
 * message sending, and error handling.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

// Mock the agent loop
jest.mock("@/lib/agent", () => ({
  runAgentLoop: jest.fn(async (_threadId: string, message: string) => ({
    content: `Echo: ${message}`,
    toolsUsed: [],
    pendingApprovals: [],
    attachments: [],
  })),
}));

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/threads/[threadId]/chat/route";
import { createThread, updateThreadStatus } from "@/lib/db/queries";
import { runAgentLoop } from "@/lib/agent";

let userId: string;
let otherUserId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "chat@test.com", role: "user" });
  otherUserId = seedTestUser({ email: "other-chat@test.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("POST /api/threads/[threadId]/chat", () => {
  let threadId: string;

  beforeEach(() => {
    const thread = createThread("Chat Test Thread", userId);
    threadId = thread.id;
    (runAgentLoop as jest.Mock).mockClear();
  });

  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const req = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: "Hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: { threadId } });
    expect(res.status).toBe(401);
  });

  test("returns 404 for non-existent thread", async () => {
    setMockUser({ id: userId, email: "chat@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/threads/no-such-thread/chat", {
      method: "POST",
      body: JSON.stringify({ message: "Hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: { threadId: "no-such-thread" } });
    expect(res.status).toBe(404);
  });

  test("returns 403 when accessing another user's thread", async () => {
    setMockUser({ id: otherUserId, email: "other-chat@test.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: "Hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: { threadId } });
    expect(res.status).toBe(403);
  });

  test("returns 409 when thread is awaiting approval", async () => {
    updateThreadStatus(threadId, "awaiting_approval");

    setMockUser({ id: userId, email: "chat@test.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: "Hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: { threadId } });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("awaiting approval");
  });

  test("returns 400 without message or attachments", async () => {
    setMockUser({ id: userId, email: "chat@test.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: { threadId } });
    expect(res.status).toBe(400);
  });

  test("sends message and returns agent response", async () => {
    setMockUser({ id: userId, email: "chat@test.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: "What is 2+2?" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: { threadId } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.content).toBe("Echo: What is 2+2?");

    // Verify runAgentLoop was called with correct args
    expect(runAgentLoop).toHaveBeenCalledWith(
      threadId,
      "What is 2+2?",
      undefined,
      undefined,
      undefined,
      userId
    );
  });

  test("returns 500 when agent loop throws", async () => {
    (runAgentLoop as jest.Mock).mockRejectedValue(new Error("LLM connection failed"));

    setMockUser({ id: userId, email: "chat@test.com", role: "user" });
    const req = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: "Hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: { threadId } });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  test("thread can receive messages after approval is resolved", async () => {
    // Simulate: thread was awaiting approval, then approval resolved → now active
    updateThreadStatus(threadId, "awaiting_approval");

    // Attempt while awaiting
    setMockUser({ id: userId, email: "chat@test.com", role: "user" });
    const blockedReq = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: "Are you there?" }),
      headers: { "Content-Type": "application/json" },
    });
    const blockedRes = await POST(blockedReq, { params: { threadId } });
    expect(blockedRes.status).toBe(409);

    // Resolve and set back to active
    updateThreadStatus(threadId, "active");

    (runAgentLoop as jest.Mock).mockResolvedValue({
      content: "Yes, I'm here!",
      toolsUsed: [],
      pendingApprovals: [],
      attachments: [],
    });

    const unblockedReq = new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: "Are you there?" }),
      headers: { "Content-Type": "application/json" },
    });
    const unblockedRes = await POST(unblockedReq, { params: { threadId } });
    expect(unblockedRes.status).toBe(200);
    const data = await unblockedRes.json();
    expect(data.content).toBe("Yes, I'm here!");
  });
});
