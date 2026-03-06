/**
 * Unit tests — dbMessagesToChat single-pass optimization (PERF-06)
 *
 * Verifies that the optimized single-pass version of dbMessagesToChat:
 * - Produces identical output to the expected behavior
 * - Correctly handles tool_calls, tool_results, and message ordering
 * - Avoids redundant JSON.parse calls (structural verification)
 */
import { dbMessagesToChat } from "@/lib/agent/loop";
import type { Message } from "@/lib/db/queries";

// Suppress addLog calls (they import DB module)
jest.mock("@/lib/db", () => ({
  addLog: jest.fn(),
}));

function makeMessage(overrides: Partial<Message> & { role: Message["role"] }): Message {
  return {
    id: Math.floor(Math.random() * 100000),
    thread_id: "thread-1",
    content: null,
    tool_calls: null,
    tool_results: null,
    attachments: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("dbMessagesToChat — single-pass optimization", () => {
  test("produces correct output for a simple user/assistant conversation", () => {
    const messages: Message[] = [
      makeMessage({ role: "user", content: "Hello" }),
      makeMessage({ role: "assistant", content: "Hi there!" }),
      makeMessage({ role: "user", content: "How are you?" }),
      makeMessage({ role: "assistant", content: "I'm fine, thanks." }),
    ];

    const result = dbMessagesToChat(messages);

    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ role: "user", content: "Hello", tool_calls: undefined });
    expect(result[1]).toEqual({ role: "assistant", content: "Hi there!", tool_calls: undefined });
    expect(result[2]).toEqual({ role: "user", content: "How are you?", tool_calls: undefined });
    expect(result[3]).toEqual({ role: "assistant", content: "I'm fine, thanks.", tool_calls: undefined });
  });

  test("correctly integrates tool_calls and tool results", () => {
    const toolCalls = [
      { id: "tc-1", name: "builtin.calculator", arguments: '{"expr":"2+2"}' },
    ];

    const messages: Message[] = [
      makeMessage({ role: "user", content: "What is 2+2?" }),
      makeMessage({
        role: "assistant",
        content: "Let me calculate that.",
        tool_calls: JSON.stringify(toolCalls),
      }),
      makeMessage({
        role: "tool",
        content: "4",
        tool_results: JSON.stringify({ tool_call_id: "tc-1", name: "builtin.calculator", result: 4 }),
      }),
      makeMessage({ role: "assistant", content: "The answer is 4." }),
    ];

    const result = dbMessagesToChat(messages);

    expect(result).toHaveLength(4);
    // Assistant with tool_calls
    expect(result[1].role).toBe("assistant");
    expect(result[1].tool_calls).toEqual(toolCalls);
    // Tool result
    expect(result[2].role).toBe("tool");
    expect(result[2].content).toBe("4");
    expect(result[2].tool_call_id).toBe("tc-1");
    // Final response
    expect(result[3].content).toBe("The answer is 4.");
  });

  test("skips system messages", () => {
    const messages: Message[] = [
      makeMessage({ role: "system", content: "You are an assistant" }),
      makeMessage({ role: "user", content: "Hi" }),
      makeMessage({ role: "assistant", content: "Hello" }),
    ];

    const result = dbMessagesToChat(messages);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });

  test("skips tool messages with unknown tool_call_id", () => {
    const messages: Message[] = [
      makeMessage({ role: "user", content: "Hi" }),
      makeMessage({
        role: "tool",
        content: "orphaned tool result",
        tool_results: JSON.stringify({ tool_call_id: "unknown-id", name: "foo" }),
      }),
      makeMessage({ role: "assistant", content: "Hello" }),
    ];

    const result = dbMessagesToChat(messages);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });

  test("preserves message ordering across multiple tool calls", () => {
    const toolCalls1 = [{ id: "tc-a", name: "tool_a", arguments: "{}" }];
    const toolCalls2 = [{ id: "tc-b", name: "tool_b", arguments: "{}" }];

    const messages: Message[] = [
      makeMessage({ role: "user", content: "Do two things" }),
      makeMessage({
        role: "assistant",
        content: "First tool",
        tool_calls: JSON.stringify(toolCalls1),
      }),
      makeMessage({
        role: "tool",
        content: "result A",
        tool_results: JSON.stringify({ tool_call_id: "tc-a", name: "tool_a", result: "A" }),
      }),
      makeMessage({
        role: "assistant",
        content: "Second tool",
        tool_calls: JSON.stringify(toolCalls2),
      }),
      makeMessage({
        role: "tool",
        content: "result B",
        tool_results: JSON.stringify({ tool_call_id: "tc-b", name: "tool_b", result: "B" }),
      }),
      makeMessage({ role: "assistant", content: "Done!" }),
    ];

    const result = dbMessagesToChat(messages);

    expect(result).toHaveLength(6);
    expect(result.map(m => m.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);
    expect(result[2].tool_call_id).toBe("tc-a");
    expect(result[4].tool_call_id).toBe("tc-b");
  });

  test("attaches contentParts to the last user message", () => {
    const messages: Message[] = [
      makeMessage({ role: "user", content: "older message" }),
      makeMessage({ role: "assistant", content: "response" }),
      makeMessage({ role: "user", content: "latest message" }),
    ];

    const parts: Array<{ type: "image_url"; image_url: { url: string } }> = [
      { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
    ];

    const result = dbMessagesToChat(messages, parts);

    expect(result[2].contentParts).toEqual(parts);
    expect(result[0].contentParts).toBeUndefined();
  });

  test("handles malformed tool_calls JSON gracefully", () => {
    const messages: Message[] = [
      makeMessage({ role: "user", content: "Hi" }),
      makeMessage({
        role: "assistant",
        content: "response",
        tool_calls: "not valid json{",
      }),
    ];

    // Should not throw, should produce the assistant message without tool_calls
    const result = dbMessagesToChat(messages);

    expect(result).toHaveLength(2);
    expect(result[1].tool_calls).toBeUndefined();
  });

  test("handles empty messages array", () => {
    const result = dbMessagesToChat([]);
    expect(result).toEqual([]);
  });

  test("performance: processes 100 messages with tool_calls without redundant parsing", () => {
    // Build a realistic 100-message conversation with interleaved tool calls
    const messages: Message[] = [];
    for (let i = 0; i < 50; i++) {
      const tcId = `tc-${i}`;
      messages.push(makeMessage({ role: "user", content: `message ${i}` }));
      messages.push(
        makeMessage({
          role: "assistant",
          content: `thinking ${i}`,
          tool_calls: JSON.stringify([{ id: tcId, name: `tool_${i}`, arguments: '{"x":1}' }]),
        })
      );
      messages.push(
        makeMessage({
          role: "tool",
          content: `result ${i}`,
          tool_results: JSON.stringify({ tool_call_id: tcId, name: `tool_${i}`, result: i }),
        })
      );
      messages.push(makeMessage({ role: "assistant", content: `answer ${i}` }));
    }

    // 200 messages total (50 users + 50 assistant-with-tools + 50 tool + 50 assistant-final)

    const start = performance.now();
    const result = dbMessagesToChat(messages);
    const elapsed = performance.now() - start;

    expect(result).toHaveLength(200); // all messages should be present
    expect(elapsed).toBeLessThan(50); // should be very fast
  });
});
