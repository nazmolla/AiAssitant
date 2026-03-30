/**
 * Integration tests — /api/conversation/respond (thread persistence)
 *
 * Verifies that the voice route now creates a thread on first call and
 * includes threadId in the done event, and resumes the same thread on
 * subsequent calls.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";

installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/conversation/respond/route";
import { getThread } from "@/lib/db/thread-queries";

// Mock the heavy agent loop so tests don't need LLM providers
jest.mock("@/lib/agent", () => ({
  runAgentLoopWithWorker: jest.fn().mockResolvedValue({
    content: "Hello from agent",
    toolsUsed: [],
    pendingApprovals: [],
    attachments: [],
  }),
}));

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "voiceroute@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

async function parseSSEDone(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const lines = text.split("\n");
  let event = "";
  for (const line of lines) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    if (line.startsWith("data: ") && event === "done") {
      return JSON.parse(line.slice(6));
    }
  }
  throw new Error("No done event found in SSE stream");
}

describe("POST /api/conversation/respond", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const req = new NextRequest("http://localhost/api/conversation/respond", {
      method: "POST",
      body: JSON.stringify({ message: "Hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 400 when message is missing", async () => {
    setMockUser({ id: userId, email: "voiceroute@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/conversation/respond", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("creates a thread on first call and returns threadId in done event", async () => {
    setMockUser({ id: userId, email: "voiceroute@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/conversation/respond", {
      method: "POST",
      body: JSON.stringify({ message: "Hello agent" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const done = await parseSSEDone(res);
    expect(typeof done.threadId).toBe("string");
    expect((done.threadId as string).length).toBeGreaterThan(0);

    // Thread should exist in DB
    const thread = getThread(done.threadId as string);
    expect(thread).toBeDefined();
    expect(thread?.user_id).toBe(userId);
  });

  test("resumes existing thread when threadId is provided", async () => {
    setMockUser({ id: userId, email: "voiceroute@example.com", role: "user" });

    // First call — create thread
    const req1 = new NextRequest("http://localhost/api/conversation/respond", {
      method: "POST",
      body: JSON.stringify({ message: "First message" }),
      headers: { "Content-Type": "application/json" },
    });
    const res1 = await POST(req1);
    const done1 = await parseSSEDone(res1);
    const threadId = done1.threadId as string;

    // Second call — resume thread
    const req2 = new NextRequest("http://localhost/api/conversation/respond", {
      method: "POST",
      body: JSON.stringify({ message: "Second message", threadId }),
      headers: { "Content-Type": "application/json" },
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const done2 = await parseSSEDone(res2);
    expect(done2.threadId).toBe(threadId);
  });

  test("returns 403 when threadId belongs to another user", async () => {
    const otherId = seedTestUser({ email: "other-voice@example.com", role: "user" });

    // Create thread as other user
    setMockUser({ id: otherId, email: "other-voice@example.com", role: "user" });
    const req1 = new NextRequest("http://localhost/api/conversation/respond", {
      method: "POST",
      body: JSON.stringify({ message: "Mine" }),
      headers: { "Content-Type": "application/json" },
    });
    const res1 = await POST(req1);
    const done1 = await parseSSEDone(res1);
    const otherThreadId = done1.threadId as string;

    // Try to use it as userId
    setMockUser({ id: userId, email: "voiceroute@example.com", role: "user" });
    const req2 = new NextRequest("http://localhost/api/conversation/respond", {
      method: "POST",
      body: JSON.stringify({ message: "Steal", threadId: otherThreadId }),
      headers: { "Content-Type": "application/json" },
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(403);
  });
});
