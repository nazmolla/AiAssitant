/**
 * Integration tests — Chat SSE streaming with thoughts (tool calls)
 *
 * Verifies the full pipeline:
 * 1. Agent loop fires onMessage for thinking (assistant+tool_calls), tool, and final messages
 * 2. SSE stream delivers all events incrementally
 * 3. Client-side processedMessages logic groups them into ThoughtSteps
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import type { Message } from "@/lib/db/queries";

// Mock runAgentLoopWithWorker to simulate tool usage — calls onMessage with realistic messages
jest.mock("@/lib/agent", () => ({
  runAgentLoopWithWorker: jest.fn(
    async (
      _threadId: string,
      _message: string,
      _cp: unknown,
      _att: unknown,
      _cont: unknown,
      _uid: unknown,
      onMessage?: (msg: Message) => void,
      onStatus?: (status: { step: string; detail?: string }) => void
    ) => {
      // The real loop calls addMessage() + onMessage() for each step.
      // Here we simulate the same sequence the real loop would produce.
      const { addMessage } = require("@/lib/db/queries");

      // Emit status events (thinking steps)
      onStatus?.({ step: "Selecting model", detail: "Task: simple → Anthropic Claude" });
      onStatus?.({ step: "Retrieving knowledge", detail: "Found 2 relevant entries" });
      onStatus?.({ step: "Generating response", detail: "Sending to Anthropic Claude" });

      // 1. Save user message
      const userMsg = addMessage({
        thread_id: _threadId,
        role: "user",
        content: _message as string,
        tool_calls: null,
        tool_results: null,
        attachments: null,
      });
      onMessage?.(userMsg);

      // 2. Save assistant thinking message (with tool_calls)
      const thinkingMsg = addMessage({
        thread_id: _threadId,
        role: "assistant",
        content: "Let me search for that information.",
        tool_calls: JSON.stringify([
          { id: "call_1", name: "web_search", arguments: { query: "test query" } },
        ]),
        tool_results: null,
        attachments: null,
      });
      onMessage?.(thinkingMsg);

      // 3. Save tool result message
      const toolMsg = addMessage({
        thread_id: _threadId,
        role: "tool",
        content: "Search results: found 3 items",
        tool_calls: null,
        tool_results: JSON.stringify({
          tool_call_id: "call_1",
          name: "web_search",
          result: "Search results: found 3 items",
        }),
        attachments: null,
      });
      onMessage?.(toolMsg);

      // 4. Save final assistant response (no tool_calls)
      const finalMsg = addMessage({
        thread_id: _threadId,
        role: "assistant",
        content: "Based on the search results, here is the answer.",
        tool_calls: null,
        tool_results: null,
        attachments: null,
      });
      onMessage?.(finalMsg);

      return {
        content: "Based on the search results, here is the answer.",
        toolsUsed: ["web_search"],
        pendingApprovals: [],
        attachments: [],
      };
    }
  ),
}));

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/threads/[threadId]/chat/route";
import { createThread, getThreadMessages } from "@/lib/db/queries";

/** Parse an SSE Response into an array of { event, data } objects */
async function parseSSE(
  res: Response
): Promise<Array<{ event: string; data: unknown }>> {
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

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "thoughts@test.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("Chat SSE — Thoughts streaming", () => {
  let threadId: string;

  beforeEach(() => {
    const thread = createThread("Thoughts Test Thread", userId);
    threadId = thread.id;
  });

  test("SSE stream includes thinking, tool, and final messages in order", async () => {
    setMockUser({ id: userId, email: "thoughts@test.com", role: "user" });
    const req = new NextRequest(
      `http://localhost/api/threads/${threadId}/chat`,
      {
        method: "POST",
        body: JSON.stringify({ message: "Search for something" }),
        headers: { "Content-Type": "application/json" },
      }
    );
    const res = await POST(req, { params: { threadId } });
    expect(res.status).toBe(200);

    const events = await parseSSE(res);

    // Should have message events for: user, assistant+tool_calls, tool, final assistant
    const messageEvents = events.filter((e) => e.event === "message");
    expect(messageEvents.length).toBe(4);

    // Verify message order and roles
    const roles = messageEvents.map(
      (e) => (e.data as { role: string }).role
    );
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);

    // Verify assistant thinking message has tool_calls
    const thinkingMsg = messageEvents[1].data as Message;
    expect(thinkingMsg.role).toBe("assistant");
    expect(thinkingMsg.tool_calls).toBeTruthy();
    expect(typeof thinkingMsg.tool_calls).toBe("string");
    const toolCalls = JSON.parse(thinkingMsg.tool_calls!);
    expect(toolCalls[0].name).toBe("web_search");

    // Verify thinking message has content (the thinking text)
    expect(thinkingMsg.content).toBe(
      "Let me search for that information."
    );

    // Verify tool result message  
    const toolResultMsg = messageEvents[2].data as Message;
    expect(toolResultMsg.role).toBe("tool");
    expect(toolResultMsg.content).toBe("Search results: found 3 items");

    // Verify final assistant message has NO tool_calls  
    const finalMsg = messageEvents[3].data as Message;
    expect(finalMsg.role).toBe("assistant");
    expect(finalMsg.tool_calls).toBeNull();
    expect(finalMsg.content).toBe(
      "Based on the search results, here is the answer."
    );

    // Verify all messages have timestamps (created_at)
    for (const event of messageEvents) {
      const msg = event.data as Message;
      expect(msg.created_at).toBeTruthy();
    }

    // Verify done event is present
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
  });

  test("messages are persisted to DB with correct fields", async () => {
    setMockUser({ id: userId, email: "thoughts@test.com", role: "user" });
    const req = new NextRequest(
      `http://localhost/api/threads/${threadId}/chat`,
      {
        method: "POST",
        body: JSON.stringify({ message: "Search for something" }),
        headers: { "Content-Type": "application/json" },
      }
    );
    await POST(req, { params: { threadId } });

    // Verify all messages in DB
    const dbMessages = getThreadMessages(threadId);

    // Should have 4 messages: user, assistant+tool_calls, tool, final assistant
    expect(dbMessages.length).toBe(4);

    // Check assistant thinking msg
    const thinking = dbMessages.find(
      (m) => m.role === "assistant" && m.tool_calls
    );
    expect(thinking).toBeDefined();
    expect(thinking!.tool_calls).toContain("web_search");
    expect(thinking!.created_at).toBeTruthy();

    // Check tool msg
    const tool = dbMessages.find((m) => m.role === "tool");
    expect(tool).toBeDefined();
    expect(tool!.content).toContain("Search results");
    expect(tool!.created_at).toBeTruthy();

    // Check final response (no tool_calls)
    const finalMsgs = dbMessages.filter(
      (m) => m.role === "assistant" && !m.tool_calls
    );
    expect(finalMsgs.length).toBe(1);
    expect(finalMsgs[0].content).toContain("answer");
  });

  test("client-side processedMessages groups thoughts correctly", () => {
    // Simulate the same data shape that comes from the SSE stream or DB
    const messages: Message[] = [
      {
        id: 1,
        thread_id: "t1",
        role: "user",
        content: "Search for something",
        tool_calls: null,
        tool_results: null,
        attachments: null,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        thread_id: "t1",
        role: "assistant",
        content: "Let me search for that.",
        tool_calls: JSON.stringify([
          {
            id: "call_1",
            name: "web_search",
            arguments: { query: "test" },
          },
        ]),
        tool_results: null,
        attachments: null,
        created_at: "2026-01-01T00:00:01Z",
      },
      {
        id: 3,
        thread_id: "t1",
        role: "tool",
        content: "Results found",
        tool_calls: null,
        tool_results: JSON.stringify({
          tool_call_id: "call_1",
          name: "web_search",
          result: "Results found",
        }),
        attachments: null,
        created_at: "2026-01-01T00:00:02Z",
      },
      {
        id: 4,
        thread_id: "t1",
        role: "assistant",
        content: "Here is your answer.",
        tool_calls: null,
        tool_results: null,
        attachments: null,
        created_at: "2026-01-01T00:00:03Z",
      },
    ];

    // Re-implement the processedMessages logic from chat-panel.tsx
    interface ThoughtStep {
      thinking: string | null;
      toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
      toolResults: Array<{ name: string; result: string }>;
      attachments: unknown[];
    }

    interface ProcessedMessage {
      msg: Message;
      thoughts: ThoughtStep[];
    }

    const result: ProcessedMessage[] = [];
    let pendingThoughts: ThoughtStep[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === "tool") {
        if (pendingThoughts.length > 0) {
          const lastThought = pendingThoughts[pendingThoughts.length - 1];
          let name = "tool";
          if (lastThought.toolCalls.length > 0) {
            const idx = lastThought.toolResults.length;
            if (idx < lastThought.toolCalls.length) {
              name = lastThought.toolCalls[idx].name;
            }
          }
          lastThought.toolResults.push({
            name,
            result: msg.content || "(no output)",
          });
        }
        continue;
      }

      if (msg.role === "assistant" && msg.tool_calls) {
        let parsedCalls: Array<{
          name: string;
          args: Record<string, unknown>;
        }> = [];
        try {
          parsedCalls = JSON.parse(msg.tool_calls).map(
            (tc: {
              name: string;
              arguments: Record<string, unknown>;
            }) => ({
              name: tc.name,
              args: tc.arguments,
            })
          );
        } catch {
          /* ignore */
        }
        pendingThoughts.push({
          thinking: msg.content,
          toolCalls: parsedCalls,
          toolResults: [],
          attachments: [],
        });
        continue;
      }

      if (msg.role === "assistant") {
        result.push({ msg, thoughts: pendingThoughts });
        pendingThoughts = [];
        continue;
      }

      // User / system
      pendingThoughts = [];
      result.push({ msg, thoughts: [] });
    }

    // Verify the processed results
    expect(result.length).toBe(2); // user + final assistant

    // User message has no thoughts
    expect(result[0].msg.role).toBe("user");
    expect(result[0].thoughts.length).toBe(0);

    // Final assistant message HAS thoughts
    expect(result[1].msg.role).toBe("assistant");
    expect(result[1].msg.content).toBe("Here is your answer.");
    expect(result[1].thoughts.length).toBe(1);
    expect(result[1].thoughts[0].thinking).toBe("Let me search for that.");
    expect(result[1].thoughts[0].toolCalls.length).toBe(1);
    expect(result[1].thoughts[0].toolCalls[0].name).toBe("web_search");
    expect(result[1].thoughts[0].toolResults.length).toBe(1);
    expect(result[1].thoughts[0].toolResults[0].name).toBe("web_search");
    expect(result[1].thoughts[0].toolResults[0].result).toBe(
      "Results found"
    );
  });

  test("multiple tool iterations group into separate thought steps", () => {
    const messages: Message[] = [
      {
        id: 1, thread_id: "t1", role: "user",
        content: "Complex task", tool_calls: null,
        tool_results: null, attachments: null, created_at: "2026-01-01T00:00:00Z",
      },
      // First thinking step
      {
        id: 2, thread_id: "t1", role: "assistant",
        content: "Step 1: search",
        tool_calls: JSON.stringify([
          { id: "call_1", name: "web_search", arguments: { query: "first" } },
        ]),
        tool_results: null, attachments: null, created_at: "2026-01-01T00:00:01Z",
      },
      {
        id: 3, thread_id: "t1", role: "tool",
        content: "First result",
        tool_calls: null,
        tool_results: JSON.stringify({ tool_call_id: "call_1", name: "web_search", result: "First result" }),
        attachments: null, created_at: "2026-01-01T00:00:02Z",
      },
      // Second thinking step
      {
        id: 4, thread_id: "t1", role: "assistant",
        content: "Step 2: read page",
        tool_calls: JSON.stringify([
          { id: "call_2", name: "browser_navigate", arguments: { url: "https://example.com" } },
        ]),
        tool_results: null, attachments: null, created_at: "2026-01-01T00:00:03Z",
      },
      {
        id: 5, thread_id: "t1", role: "tool",
        content: "Page content: Hello World",
        tool_calls: null,
        tool_results: JSON.stringify({ tool_call_id: "call_2", name: "browser_navigate", result: "Page content: Hello World" }),
        attachments: null, created_at: "2026-01-01T00:00:04Z",
      },
      // Final response
      {
        id: 6, thread_id: "t1", role: "assistant",
        content: "After searching and reading, here is the answer.",
        tool_calls: null, tool_results: null, attachments: null,
        created_at: "2026-01-01T00:00:05Z",
      },
    ];

    interface ThoughtStep {
      thinking: string | null;
      toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
      toolResults: Array<{ name: string; result: string }>;
    }

    const result: Array<{ msg: Message; thoughts: ThoughtStep[] }> = [];
    let pendingThoughts: ThoughtStep[] = [];

    for (const msg of messages) {
      if (msg.role === "tool") {
        if (pendingThoughts.length > 0) {
          const lastThought = pendingThoughts[pendingThoughts.length - 1];
          let name = "tool";
          const idx = lastThought.toolResults.length;
          if (idx < lastThought.toolCalls.length) {
            name = lastThought.toolCalls[idx].name;
          }
          lastThought.toolResults.push({ name, result: msg.content || "" });
        }
        continue;
      }
      if (msg.role === "assistant" && msg.tool_calls) {
        let parsedCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
        try {
          parsedCalls = JSON.parse(msg.tool_calls).map(
            (tc: { name: string; arguments: Record<string, unknown> }) => ({
              name: tc.name,
              args: tc.arguments,
            })
          );
        } catch { /* ignore */ }
        pendingThoughts.push({ thinking: msg.content, toolCalls: parsedCalls, toolResults: [] });
        continue;
      }
      if (msg.role === "assistant") {
        result.push({ msg, thoughts: pendingThoughts });
        pendingThoughts = [];
        continue;
      }
      pendingThoughts = [];
      result.push({ msg, thoughts: [] });
    }

    // Should have 2 processed messages: user + final assistant
    expect(result.length).toBe(2);

    // Final assistant should have 2 thought steps
    const final = result[1];
    expect(final.thoughts.length).toBe(2);

    // First step: web_search
    expect(final.thoughts[0].thinking).toBe("Step 1: search");
    expect(final.thoughts[0].toolCalls[0].name).toBe("web_search");
    expect(final.thoughts[0].toolResults[0].name).toBe("web_search");

    // Second step: browser_navigate
    expect(final.thoughts[1].thinking).toBe("Step 2: read page");
    expect(final.thoughts[1].toolCalls[0].name).toBe("browser_navigate");
    expect(final.thoughts[1].toolResults[0].name).toBe("browser_navigate");
  });

  test("SSE stream includes status events for agent analysis steps", async () => {
    setMockUser({ id: userId, email: "thoughts@test.com", role: "user" });
    const req = new NextRequest(
      `http://localhost/api/threads/${threadId}/chat`,
      {
        method: "POST",
        body: JSON.stringify({ message: "Hello there" }),
        headers: { "Content-Type": "application/json" },
      }
    );
    const res = await POST(req, { params: { threadId } });
    expect(res.status).toBe(200);

    const events = await parseSSE(res);

    // Should have status events
    const statusEvents = events.filter((e) => e.event === "status");
    expect(statusEvents.length).toBeGreaterThanOrEqual(3);

    // Verify status event structure
    const steps = statusEvents.map((e) => (e.data as { step: string; detail?: string }));
    const stepNames = steps.map((s) => s.step);
    expect(stepNames).toContain("Selecting model");
    expect(stepNames).toContain("Retrieving knowledge");
    expect(stepNames).toContain("Generating response");

    // Verify details are present
    const selectingModel = steps.find((s) => s.step === "Selecting model");
    expect(selectingModel?.detail).toContain("Anthropic Claude");

    const retrieving = steps.find((s) => s.step === "Retrieving knowledge");
    expect(retrieving?.detail).toContain("2 relevant entries");

    // Verify status events come BEFORE message events
    const firstStatusIdx = events.findIndex((e) => e.event === "status");
    const firstMessageIdx = events.findIndex((e) => e.event === "message");
    expect(firstStatusIdx).toBeLessThan(firstMessageIdx);

    // Regular message events should still be present
    const messageEvents = events.filter((e) => e.event === "message");
    expect(messageEvents.length).toBeGreaterThanOrEqual(2); // user + final assistant

    // Done event should still be present
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
  });
});
