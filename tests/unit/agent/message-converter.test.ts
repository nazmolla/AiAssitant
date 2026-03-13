/**
 * Unit tests — dbMessagesToChat (message-converter.ts)
 *
 * Validates:
 * - Normal message conversion (user, assistant, tool)
 * - Complete tool call sequences are preserved
 * - Orphaned assistant tool_calls (missing tool results) are stripped
 * - Partial tool results (some present, some missing) — entire batch stripped
 * - System messages are excluded
 */
import type { Message } from "@/lib/db/thread-queries";

jest.mock("@/lib/db", () => ({
  addLog: jest.fn(),
}));

jest.mock("@/lib/agent/system-prompt", () => ({
  isUntrustedToolOutput: () => false,
}));

import { dbMessagesToChat } from "@/lib/agent/message-converter";

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
    // The orphaned assistant message should be stripped
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ role: "user", content: "Fetch this" });
    expect(result[1]).toMatchObject({ role: "user", content: "What happened?" });
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
    // Both the assistant tool_calls message and the partial tool result should be stripped
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ role: "user", content: "Do two things" });
    expect(result[1]).toMatchObject({ role: "user", content: "Next question" });
  });

  test("preserves messages before and after an orphaned batch", () => {
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
    // Good sequence preserved, orphaned batch stripped, surrounding messages kept
    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({ role: "user", content: "First question" });
    expect(result[1].role).toBe("assistant");
    expect(result[1].tool_calls).toHaveLength(1);
    expect(result[2]).toMatchObject({ role: "tool", tool_call_id: "call_good" });
    expect(result[3]).toMatchObject({ role: "assistant", content: "Here is the answer" });
    expect(result[4]).toMatchObject({ role: "user", content: "Second question" });
    expect(result[5]).toMatchObject({ role: "user", content: "Still waiting" });
  });
});
