/**
 * Unit tests for POST /api/conversation/respond — routing and thread lifecycle (#210, #271).
 *
 * The conversation route now uses runAgentLoopWithWorker (full loop with context
 * enrichment, persistence, tools) rather than a bespoke lightweight loop.
 * Context enrichment (knowledge, profile, MCP) happens inside the agent loop.
 *
 * These tests verify:
 *  - The route creates a new thread when no threadId is provided
 *  - The route resumes an existing thread when threadId is provided
 *  - threadId is returned in the SSE done event
 *  - runAgentLoopWithWorker is called with the correct arguments
 *
 * @jest-environment node
 */

// ── DB mocks — must be before imports ────────────────────────────────────────

const MOCK_THREAD_ID = "test-thread-uuid-001";
const MOCK_THREAD = {
  id: MOCK_THREAD_ID,
  user_id: "user-1",
  title: "Voice Conversation",
  thread_type: "interactive",
  is_interactive: 1,
  status: "active",
};

jest.mock("@/lib/db/thread-queries", () => ({
  createThread: jest.fn().mockReturnValue(MOCK_THREAD),
  getThread: jest.fn().mockReturnValue(MOCK_THREAD),
}));

// ── Auth mock ─────────────────────────────────────────────────────────────────

jest.mock("@/lib/auth/guard", () => ({
  requireUser: jest.fn().mockResolvedValue({
    user: { id: "user-1", email: "test@example.com", role: "user" },
  }),
}));

// ── Agent loop mock ───────────────────────────────────────────────────────────

const mockRunAgentLoopWithWorker = jest.fn().mockResolvedValue({
  content: "Hello from agent",
  toolsUsed: [],
  pendingApprovals: [],
  attachments: [],
});

jest.mock("@/lib/agent", () => ({
  runAgentLoopWithWorker: (...args: unknown[]) => mockRunAgentLoopWithWorker(...args),
}));

// ── SSE mock ──────────────────────────────────────────────────────────────────

const sentEvents: string[] = [];
jest.mock("@/lib/sse", () => ({
  createSSEStream: jest.fn().mockReturnValue({
    send: jest.fn().mockImplementation((ev: string) => sentEvents.push(ev)),
    close: jest.fn(),
  }),
  sseResponse: jest.fn().mockReturnValue(new Response()),
  sseEvent: jest.fn().mockImplementation((type: string, data: unknown) => {
    return `event:${type}|data:${JSON.stringify(data)}`;
  }),
}));

// ── Import route after all mocks ─────────────────────────────────────────────

import { NextRequest } from "next/server";
import { createThread, getThread } from "@/lib/db/thread-queries";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/conversation/respond — routing and thread lifecycle", () => {
  beforeEach(() => {
    sentEvents.length = 0;
    jest.clearAllMocks();
    (createThread as jest.Mock).mockReturnValue(MOCK_THREAD);
    (getThread as jest.Mock).mockReturnValue(MOCK_THREAD);
    mockRunAgentLoopWithWorker.mockResolvedValue({
      content: "Hello from agent",
      toolsUsed: [],
      pendingApprovals: [],
      attachments: [],
    });
  });

  test("creates a new thread when no threadId provided", async () => {
    const { POST } = await import("@/app/api/conversation/respond/route");
    const req = new NextRequest("http://localhost/api/conversation/respond", {
      method: "POST",
      body: JSON.stringify({ message: "What lights are on?" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    expect(createThread).toHaveBeenCalledWith("Voice Conversation", "user-1");
  });

  test("resumes existing thread when threadId is provided", async () => {
    const { POST } = await import("@/app/api/conversation/respond/route");
    const req = new NextRequest("http://localhost/api/conversation/respond", {
      method: "POST",
      body: JSON.stringify({ message: "Hello", threadId: MOCK_THREAD_ID }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    expect(getThread).toHaveBeenCalledWith(MOCK_THREAD_ID);
    expect(createThread).not.toHaveBeenCalled();
  });

  test("calls runAgentLoopWithWorker with correct threadId, message, and userId", async () => {
    const { POST } = await import("@/app/api/conversation/respond/route");
    const req = new NextRequest("http://localhost/api/conversation/respond", {
      method: "POST",
      body: JSON.stringify({ message: "Test message" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    // Allow fire-and-forget async loop to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRunAgentLoopWithWorker).toHaveBeenCalledWith(
      MOCK_THREAD_ID,
      "Test message",
      undefined,
      undefined,
      undefined,
      "user-1",
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
  });

  test("done event includes threadId", async () => {
    const { POST } = await import("@/app/api/conversation/respond/route");
    const req = new NextRequest("http://localhost/api/conversation/respond", {
      method: "POST",
      body: JSON.stringify({ message: "Hello" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    await new Promise((r) => setTimeout(r, 50));

    const doneEvent = sentEvents.find((e) => e.startsWith("event:done"));
    expect(doneEvent).toBeDefined();
    expect(doneEvent).toContain(MOCK_THREAD_ID);
  });

  test("returns 403 when threadId belongs to another user", async () => {
    (getThread as jest.Mock).mockReturnValue({ ...MOCK_THREAD, user_id: "other-user" });
    const { POST } = await import("@/app/api/conversation/respond/route");
    const req = new NextRequest("http://localhost/api/conversation/respond", {
      method: "POST",
      body: JSON.stringify({ message: "Hello", threadId: MOCK_THREAD_ID }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
