/**
 * Unit tests — dbMessagesToChat + compactHistory (message-converter.ts)
 *
 * Validates:
 * - Normal message conversion (user, assistant, tool)
 * - Complete tool call sequences are preserved
 * - Orphaned assistant tool_calls (missing tool results) are stripped
 * - Partial tool results (some present, some missing) — entire batch stripped
 * - System messages are excluded
 * - Consecutive user messages are merged (prevents Azure 400 after orphan strip)
 * - compactHistory trims by character budget, lands on user boundary, returns summary
 */
import type { Message } from "@/lib/db/thread-queries";

jest.mock("@/lib/db", () => ({
  addLog: jest.fn(),
}));

jest.mock("@/lib/agent/system-prompt", () => ({
  isUntrustedToolOutput: () => false,
}));

import { dbMessagesToChat, compactHistory } from "@/lib/agent/message-converter";
import type { ChatMessage } from "@/lib/llm";

function makeDbMsg(
  id: number,
  role: "user" | "assistant" | "system" | "tool",
  content: string | null,
  overrides: Partial<Message> = {}
): Message {
  return {
    id,
    thread_id: "thread-1",
    role,
    content,
    tool_calls: null,
    tool_results: null,
    attachments: null,
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("dbMessagesToChat", () => {
  test("converts basic user and assistant messages", () => {
    const messages = [
      makeDbMsg(1, "user", "Hello"),
      makeDbMsg(2, "assistant", "Hi there"),
    ];
    const result = dbMessagesToChat(messages);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: "user", content: "Hello", tool_calls: undefined });
    expect(result[1]).toEqual({ role: "assistant", content: "Hi there", tool_calls: undefined });
  });

  test("excludes system messages", () => {
    const messages = [
      makeDbMsg(1, "user", "Hello"),
      makeDbMsg(2, "system", "System notice"),
      makeDbMsg(3, "assistant", "Reply"),
    ];
    const result = dbMessagesToChat(messages);
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.role !== "system")).toBe(true);
  });

  test("preserves complete tool call sequences", () => {
    const toolCalls = JSON.stringify([{ id: "call_abc", name: "web_search", arguments: { q: "test" } }]);
    const toolResults = JSON.stringify({ tool_call_id: "call_abc", name: "web_search" });
    const messages = [
      makeDbMsg(1, "user", "Search for test"),
      makeDbMsg(2, "assistant", null, { tool_calls: toolCalls }),
      makeDbMsg(3, "tool", "Search results here", { tool_results: toolResults }),
      makeDbMsg(4, "assistant", "Here are the results"),
    ];
    const result = dbMessagesToChat(messages);
    expect(result).toHaveLength(4);
    expect(result[1].role).toBe("assistant");
    expect(result[1].tool_calls).toHaveLength(1);
    expect(result[2].role).toBe("tool");
    expect(result[2].tool_call_id).toBe("call_abc");
  });

  test("strips orphaned assistant tool_calls when tool results are completely missing", () => {
    const toolCalls = JSON.stringify([{ id: "call_orphan", name: "web_fetch", arguments: { url: "http://example.com" } }]);
    const messages = [
      makeDbMsg(1, "user", "Fetch this"),
      makeDbMsg(2, "assistant", "Let me fetch that", { tool_calls: toolCalls }),
      // No tool result message for call_orphan
      makeDbMsg(3, "user", "What happened?"),
    ];
    const result = dbMessagesToChat(messages);
    // The orphaned assistant message is stripped, leaving two consecutive user
    // messages that are then merged to prevent strict-provider 400 errors.
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("Fetch this");
    expect(result[0].content).toContain("What happened?");
  });

  test("merges consecutive user messages that arise after orphan strip (multi-agent scenario)", () => {
    // Simulates the multi-agent pattern: orchestrator dispatches an inner agent
    // as its first and only tool call in a turn.  The dispatch_agent tool call
    // is orphaned (inner loop runs during execution, result not yet in DB).
    // After stripping the orphaned assistant message the outer user message and
    // the inner agent's injected task message would be adjacent.
    const dispatchToolCalls = JSON.stringify([
      { id: "call_dispatch", name: "dispatch_agent", arguments: { agent: "web_researcher", task: "Find X" } },
    ]);
    const messages = [
      makeDbMsg(1, "user", "Proactive trigger"),
      makeDbMsg(2, "assistant", null, { tool_calls: dispatchToolCalls }), // orphaned — no tool result
      makeDbMsg(3, "user", "## Your role\nWeb Researcher\n\n## Task\nFind X"),
    ];
    const result = dbMessagesToChat(messages);
    // Orphaned assistant stripped → two consecutive user messages → merged into one
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("Proactive trigger");
    expect(result[0].content).toContain("## Your role");
  });

  test("strips entire batch when only some tool results are present (partial)", () => {
    const toolCalls = JSON.stringify([
      { id: "call_1", name: "web_search", arguments: { q: "a" } },
      { id: "call_2", name: "web_fetch", arguments: { url: "b" } },
    ]);
    const toolResults1 = JSON.stringify({ tool_call_id: "call_1", name: "web_search" });
    // call_2 tool result is missing
    const messages = [
      makeDbMsg(1, "user", "Do two things"),
      makeDbMsg(2, "assistant", null, { tool_calls: toolCalls }),
      makeDbMsg(3, "tool", "Result 1", { tool_results: toolResults1 }),
      // Missing: tool result for call_2
      makeDbMsg(4, "user", "Next question"),
    ];
    const result = dbMessagesToChat(messages);
    // The assistant tool_calls and orphaned partial tool result are stripped.
    // The two remaining consecutive user messages are merged into one.
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("Do two things");
    expect(result[0].content).toContain("Next question");
  });

  test("preserves messages before and after an orphaned batch, merging adjacent user messages", () => {
    const goodToolCalls = JSON.stringify([{ id: "call_good", name: "web_search", arguments: {} }]);
    const goodToolResults = JSON.stringify({ tool_call_id: "call_good", name: "web_search" });
    const orphanedToolCalls = JSON.stringify([{ id: "call_bad", name: "file_read", arguments: {} }]);

    const messages = [
      makeDbMsg(1, "user", "First question"),
      makeDbMsg(2, "assistant", null, { tool_calls: goodToolCalls }),
      makeDbMsg(3, "tool", "Good result", { tool_results: goodToolResults }),
      makeDbMsg(4, "assistant", "Here is the answer"),
      makeDbMsg(5, "user", "Second question"),
      makeDbMsg(6, "assistant", null, { tool_calls: orphanedToolCalls }),
      // Missing tool result for call_bad
      makeDbMsg(7, "user", "Still waiting"),
    ];
    const result = dbMessagesToChat(messages);
    // Good sequence preserved; orphaned batch stripped; "Second question" and
    // "Still waiting" are consecutive user messages after the strip → merged.
    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({ role: "user", content: "First question" });
    expect(result[1].role).toBe("assistant");
    expect(result[1].tool_calls).toHaveLength(1);
    expect(result[2]).toMatchObject({ role: "tool", tool_call_id: "call_good" });
    expect(result[3]).toMatchObject({ role: "assistant", content: "Here is the answer" });
    expect(result[4].role).toBe("user");
    expect(result[4].content).toContain("Second question");
    expect(result[4].content).toContain("Still waiting");
  });
});

// ── compactHistory ────────────────────────────────────────────────────────────

function makeChat(role: "user" | "assistant" | "tool", content: string): ChatMessage {
  return { role, content };
}

describe("compactHistory", () => {
  test("returns null when total chars are within budget", () => {
    const msgs: ChatMessage[] = [
      makeChat("user", "Hello"),
      makeChat("assistant", "Hi"),
      makeChat("user", "How are you?"),
      makeChat("assistant", "Fine"),
    ];
    const result = compactHistory(msgs, 10_000);
    expect(result).toBeNull();
    expect(msgs).toHaveLength(4); // untouched
  });

  test("trims messages exceeding the character budget and returns a summary", () => {
    // Each message is 100 chars; budget is 250 → keep last 2 full messages + partial
    const long = "A".repeat(100);
    const msgs: ChatMessage[] = [
      makeChat("user", long),       // 100 chars — should be trimmed
      makeChat("assistant", long),  // 100 chars — should be trimmed
      makeChat("user", long),       // 100 chars — kept (first user boundary after cut)
      makeChat("assistant", long),  // 100 chars — kept
    ];
    const summary = compactHistory(msgs, 250);
    expect(summary).not.toBeNull();
    expect(summary).toContain("compacted");
    // The first two messages should be removed
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
  });

  test("cut always lands on a user-message boundary (never splits mid-turn)", () => {
    const long = "B".repeat(200);
    // layout: user(200) assistant(200) tool(200) user(200) assistant(200)
    // budget 400 → raw keepFrom would be at index 3 (last 2*200=400 chars)
    // but index 3 is already a user message — cut lands there cleanly
    const msgs: ChatMessage[] = [
      makeChat("user", long),
      makeChat("assistant", long),
      makeChat("tool", long),
      makeChat("user", long),
      makeChat("assistant", long),
    ];
    compactHistory(msgs, 400);
    // First kept message must be a user message
    expect(msgs[0].role).toBe("user");
  });

  test("summary includes truncated previews of removed user and assistant messages", () => {
    const msgs: ChatMessage[] = [
      makeChat("user", "What is the weather today?"),
      makeChat("assistant", "It is sunny and 25 degrees."),
      makeChat("user", "Thanks!"),
      makeChat("assistant", "You're welcome."),
      makeChat("user", "One more question"),
      makeChat("assistant", "Sure"),
    ];
    // Budget of 30 chars forces trimming of early messages
    const summary = compactHistory(msgs, 30);
    expect(summary).toContain("User:");
    expect(summary).toContain("Assistant:");
  });

  test("does not trim when all content fits in budget", () => {
    const msgs: ChatMessage[] = [makeChat("user", "hi"), makeChat("assistant", "hello")];
    const result = compactHistory(msgs, 1_000_000);
    expect(result).toBeNull();
    expect(msgs).toHaveLength(2);
  });
});
