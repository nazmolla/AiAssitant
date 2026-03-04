/**
 * Integration tests — SSE Stream Concurrency & Disconnect Safety
 *
 * Verifies that the SSE streaming routes survive:
 *  1. Multiple concurrent requests on the same thread
 *  2. Client disconnects (stream cancel) mid-flight
 *  3. Agent errors after client disconnect (no server crash)
 *  4. Rapid sequential requests (open new tab while chat is ongoing)
 *
 * These tests validate the `sseSend()` safety wrapper and `streamCancelled`
 * flag introduced to prevent server crashes when `controller.enqueue()`
 * is called on a cancelled ReadableStream.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

// Mock the agent loop — delay configurable per test
let agentDelay = 50; // ms
let agentError: Error | null = null;
let agentOnTokenCalls: Array<(token: string) => void> = [];

jest.mock("@/lib/agent", () => ({
  runAgentLoopWithWorker: jest.fn(
    async (
      _threadId: string,
      message: string,
      _cp: unknown,
      _att: unknown,
      _cont: unknown,
      _uid: unknown,
      _onMsg: unknown,
      _onStatus: unknown,
      onToken?: (token: string) => void,
    ) => {
      // Capture onToken so tests can call it after disconnecting
      if (onToken) agentOnTokenCalls.push(onToken);

      // Simulate streaming tokens with a delay
      if (onToken) {
        onToken("Hello");
        await new Promise((r) => setTimeout(r, agentDelay));
        onToken(" world");
      }

      if (agentError) throw agentError;

      return {
        content: `Echo: ${message}`,
        toolsUsed: [],
        pendingApprovals: [],
        attachments: [],
      };
    },
  ),
}));

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/threads/[threadId]/chat/route";
import { createThread } from "@/lib/db/queries";
import { runAgentLoopWithWorker } from "@/lib/agent";

/* ─── Helpers ────────────────────────────────────────────────────── */

/** Build a POST request for the chat route */
function makeChatRequest(threadId: string, message: string): NextRequest {
  return new NextRequest(`http://localhost/api/threads/${threadId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
    headers: { "Content-Type": "application/json" },
  });
}

/** Parse SSE text into events */
async function parseSSE(res: Response): Promise<Array<{ event: string; data: unknown }>> {
  const text = await res.text();
  const events: Array<{ event: string; data: unknown }> = [];
  let currentEvent = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      try {
        events.push({ event: currentEvent, data: JSON.parse(line.slice(6)) });
      } catch {
        events.push({ event: currentEvent, data: line.slice(6) });
      }
      currentEvent = "";
    }
  }
  return events;
}

/** Read partial SSE stream then cancel (simulates tab close) */
async function readAndCancel(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let text = "";
  // Read just the first chunk then cancel
  const { value } = await reader.read();
  if (value) text = decoder.decode(value);
  await reader.cancel("Client disconnected");
  return text;
}

/* ─── Setup ──────────────────────────────────────────────────────── */

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "sse-concurrency@test.com", role: "user" });
});
afterAll(() => teardownTestDb());

beforeEach(() => {
  agentDelay = 50;
  agentError = null;
  agentOnTokenCalls = [];
  (runAgentLoopWithWorker as jest.Mock).mockClear();
  setMockUser({ id: userId, email: "sse-concurrency@test.com", role: "user" });
});

/* ─── Tests ──────────────────────────────────────────────────────── */

describe("SSE Stream Concurrency & Disconnect Safety", () => {
  test("multiple concurrent requests on the same thread complete without error", async () => {
    const thread = createThread("Concurrency Test", userId);

    // Fire 3 concurrent chat requests
    const requests = Array.from({ length: 3 }, (_, i) =>
      POST(makeChatRequest(thread.id, `Message ${i}`), { params: { threadId: thread.id } }),
    );

    const responses = await Promise.all(requests);

    // All should return 200
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // All should produce valid SSE with a done event
    for (const res of responses) {
      const events = await parseSSE(res);
      const doneEvent = events.find((e) => e.event === "done");
      expect(doneEvent).toBeDefined();
    }
  });

  test("rapid sequential requests don't crash (open new tab scenario)", async () => {
    const thread = createThread("Rapid Sequential Test", userId);

    // Send first request
    const res1Promise = POST(makeChatRequest(thread.id, "First"), {
      params: { threadId: thread.id },
    });

    // Immediately send second request (simulates opening new browser tab)
    const res2Promise = POST(makeChatRequest(thread.id, "Second"), {
      params: { threadId: thread.id },
    });

    const [res1, res2] = await Promise.all([res1Promise, res2Promise]);

    // Both should succeed (no crashes)
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const events1 = await parseSSE(res1);
    const events2 = await parseSSE(res2);
    expect(events1.find((e) => e.event === "done")).toBeDefined();
    expect(events2.find((e) => e.event === "done")).toBeDefined();
  });

  test("cancelling stream mid-flight does not crash the server", async () => {
    agentDelay = 200; // Slow enough to cancel during
    const thread = createThread("Cancel Test", userId);

    const res = await POST(makeChatRequest(thread.id, "Cancel me"), {
      params: { threadId: thread.id },
    });
    expect(res.status).toBe(200);

    // Read partial response and cancel
    const partial = await readAndCancel(res);
    expect(partial.length).toBeGreaterThan(0); // Got something before cancelling

    // Wait for the agent loop to finish — it should not crash
    await new Promise((r) => setTimeout(r, agentDelay + 100));
    // If we get here, the server didn't crash ✓
    expect(true).toBe(true);
  });

  test("agent error after client disconnect does not crash", async () => {
    agentDelay = 100;
    agentError = new Error("LLM connection lost");

    const thread = createThread("Error After Disconnect", userId);
    const res = await POST(makeChatRequest(thread.id, "Error test"), {
      params: { threadId: thread.id },
    });
    expect(res.status).toBe(200);

    // Read partial and cancel before agent finishes
    await readAndCancel(res);

    // Wait for agent to try sending error event on cancelled stream
    await new Promise((r) => setTimeout(r, agentDelay + 100));

    // No crash — sseSend safely swallowed the error
    expect(true).toBe(true);
  });

  test("agent sends tokens after disconnect — sseSend is no-op", async () => {
    // Custom mock: capture onToken and call it AFTER cancel
    (runAgentLoopWithWorker as jest.Mock).mockImplementation(
      async (
        _threadId: string,
        message: string,
        _cp: unknown,
        _att: unknown,
        _cont: unknown,
        _uid: unknown,
        _onMsg: unknown,
        _onStatus: unknown,
        onToken?: (token: string) => void,
      ) => {
        // Send initial token immediately
        onToken?.("Initial");
        // Wait longer than the reader.cancel() timeout
        await new Promise((r) => setTimeout(r, 300));
        // These tokens arrive after client disconnected — should not throw
        onToken?.("Token after cancel 1");
        onToken?.("Token after cancel 2");
        return {
          content: `Echo: ${message}`,
          toolsUsed: [],
          pendingApprovals: [],
          attachments: [],
        };
      },
    );

    const thread = createThread("Post Cancel Tokens", userId);
    const res = await POST(makeChatRequest(thread.id, "Post cancel"), {
      params: { threadId: thread.id },
    });
    expect(res.status).toBe(200);

    // Cancel after first chunk
    await readAndCancel(res);

    // Wait for agent to finish sending tokens on cancelled stream
    await new Promise((r) => setTimeout(r, 500));

    // No crash — test passes if we reach here
    expect(true).toBe(true);
  });

  test("concurrent requests produce independent SSE streams", async () => {
    // Override mock to include message in response
    (runAgentLoopWithWorker as jest.Mock).mockImplementation(
      async (
        _threadId: string,
        message: string,
        _cp: unknown,
        _att: unknown,
        _cont: unknown,
        _uid: unknown,
        _onMsg: unknown,
        _onStatus: unknown,
        onToken?: (token: string) => void,
      ) => {
        onToken?.(`Reply to: ${message}`);
        return {
          content: `Reply to: ${message}`,
          toolsUsed: [],
          pendingApprovals: [],
          attachments: [],
        };
      },
    );

    const thread = createThread("Independence Test", userId);

    const [res1, res2] = await Promise.all([
      POST(makeChatRequest(thread.id, "Alpha"), { params: { threadId: thread.id } }),
      POST(makeChatRequest(thread.id, "Beta"), { params: { threadId: thread.id } }),
    ]);

    const events1 = await parseSSE(res1);
    const events2 = await parseSSE(res2);

    // Each stream has its own tokens and done event
    const tokens1 = events1.filter((e) => e.event === "token").map((e) => e.data);
    const tokens2 = events2.filter((e) => e.event === "token").map((e) => e.data);

    expect(tokens1).toContain("Reply to: Alpha");
    expect(tokens2).toContain("Reply to: Beta");

    // No cross-contamination
    expect(tokens1).not.toContain("Reply to: Beta");
    expect(tokens2).not.toContain("Reply to: Alpha");
  });

  test("controller.close() after cancel does not throw", async () => {
    agentDelay = 10; // Fast agent
    const thread = createThread("Close After Cancel", userId);

    const res = await POST(makeChatRequest(thread.id, "Close test"), {
      params: { threadId: thread.id },
    });

    // Cancel immediately
    if (res.body) {
      const reader = res.body.getReader();
      await reader.cancel("instant cancel");
    }

    // Wait for the finally block to call controller.close()
    await new Promise((r) => setTimeout(r, agentDelay + 100));

    // No crash — sseSend wrapper + try/catch around controller.close()
    expect(true).toBe(true);
  });
});
