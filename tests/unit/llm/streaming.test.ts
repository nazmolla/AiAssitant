/**
 * Tests for LLM provider streaming support.
 * Verifies that both OpenAI and Anthropic providers correctly stream tokens
 * via the onToken callback and fall back to non-streaming when no callback is provided.
 */

import { OpenAIChatProvider } from "@/lib/llm/openai-provider";
import { AnthropicChatProvider } from "@/lib/llm/anthropic-provider";
import type { ChatMessage, ToolDefinition } from "@/lib/llm/types";

// Mock OpenAI SDK
jest.mock("openai", () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));
});

// Mock Anthropic SDK
jest.mock("@anthropic-ai/sdk", () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn(),
      stream: jest.fn(),
    },
  }));
});

describe("OpenAIChatProvider streaming", () => {
  let provider: OpenAIChatProvider;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    provider = new OpenAIChatProvider({ variant: "openai", apiKey: "test-key", model: "gpt-4o" });
    // Access the mocked client
    mockCreate = (provider as any).client.chat.completions.create;
  });

  test("uses non-streaming when onToken is not provided", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: "Hello world", tool_calls: null },
          finish_reason: "stop",
        },
      ],
    });

    const messages: ChatMessage[] = [{ role: "user", content: "Hi" }];
    const result = await provider.chat(messages);

    expect(result.content).toBe("Hello world");
    expect(result.finishReason).toBe("stop");
    expect(result.toolCalls).toEqual([]);
    // Verify no stream option was passed
    expect(mockCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ stream: true })
    );
  });

  test("uses streaming when onToken is provided", async () => {
    // Simulate async iterable of chunks
    const chunks = [
      { choices: [{ delta: { content: "Hello" }, finish_reason: null }] },
      { choices: [{ delta: { content: " world" }, finish_reason: null }] },
      { choices: [{ delta: { content: "!" }, finish_reason: "stop" }] },
    ];

    mockCreate.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk;
      },
    });

    const tokens: string[] = [];
    const messages: ChatMessage[] = [{ role: "user", content: "Hi" }];
    const result = await provider.chat(messages, undefined, undefined, (token) => {
      tokens.push(token);
    });

    expect(tokens).toEqual(["Hello", " world", "!"]);
    expect(result.content).toBe("Hello world!");
    expect(result.finishReason).toBe("stop");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true })
    );
  });

  test("handles streaming with tool calls", async () => {
    const chunks = [
      { choices: [{ delta: { content: "Let me check" }, finish_reason: null }] },
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_1",
              function: { name: "web_search", arguments: '{"query":' },
            }],
          },
          finish_reason: null,
        }],
      },
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: '"hello"}' },
            }],
          },
          finish_reason: null,
        }],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ];

    mockCreate.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk;
      },
    });

    const tokens: string[] = [];
    const messages: ChatMessage[] = [{ role: "user", content: "search hello" }];
    const tools: ToolDefinition[] = [{
      name: "web_search",
      description: "Search the web",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    }];

    const result = await provider.chat(messages, tools, undefined, (token) => {
      tokens.push(token);
    });

    expect(tokens).toEqual(["Let me check"]);
    expect(result.content).toBe("Let me check");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("web_search");
    expect(result.toolCalls[0].arguments).toEqual({ query: "hello" });
    expect(result.finishReason).toBe("tool_calls");
  });

  test("handles empty streaming response", async () => {
    const chunks = [
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ];

    mockCreate.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk;
      },
    });

    const tokens: string[] = [];
    const messages: ChatMessage[] = [{ role: "user", content: "Hi" }];
    const result = await provider.chat(messages, undefined, undefined, (token) => {
      tokens.push(token);
    });

    expect(tokens).toEqual([]);
    expect(result.content).toBeNull();
    expect(result.finishReason).toBe("stop");
  });
});

describe("AnthropicChatProvider streaming", () => {
  let provider: AnthropicChatProvider;
  let mockCreate: jest.Mock;
  let mockStream: jest.Mock;

  beforeEach(() => {
    provider = new AnthropicChatProvider({ apiKey: "test-key", model: "claude-sonnet-4-20250514" });
    mockCreate = (provider as any).client.messages.create;
    mockStream = (provider as any).client.messages.stream;
  });

  test("uses non-streaming when onToken is not provided", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello world" }],
      stop_reason: "end_turn",
    });

    const messages: ChatMessage[] = [{ role: "user", content: "Hi" }];
    const result = await provider.chat(messages);

    expect(result.content).toBe("Hello world");
    expect(result.finishReason).toBe("end_turn");
    expect(result.toolCalls).toEqual([]);
    expect(mockCreate).toHaveBeenCalled();
    expect(mockStream).not.toHaveBeenCalled();
  });

  test("uses streaming when onToken is provided", async () => {
    // Mock stream as async iterable + finalMessage
    const events = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: " world" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "!" } },
      { type: "message_stop" },
    ];

    mockStream.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const event of events) yield event;
      },
      finalMessage: jest.fn().mockResolvedValue({
        content: [{ type: "text", text: "Hello world!" }],
        stop_reason: "end_turn",
      }),
    });

    const tokens: string[] = [];
    const messages: ChatMessage[] = [{ role: "user", content: "Hi" }];

    const result = await provider.chat(messages, undefined, undefined, (token) => {
      tokens.push(token);
    });

    expect(tokens).toEqual(["Hello", " world", "!"]);
    expect(result.content).toBe("Hello world!");
    expect(result.finishReason).toBe("end_turn");
    expect(mockStream).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("handles streaming with tool calls", async () => {
    const events = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "I'll search for that" } },
      { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"query":"hello"}' } },
      { type: "message_stop" },
    ];

    mockStream.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const event of events) yield event;
      },
      finalMessage: jest.fn().mockResolvedValue({
        content: [
          { type: "text", text: "I'll search for that" },
          {
            type: "tool_use",
            id: "tool_1",
            name: "web_search",
            input: { query: "hello" },
          },
        ],
        stop_reason: "tool_use",
      }),
    });

    const tokens: string[] = [];
    const messages: ChatMessage[] = [{ role: "user", content: "search hello" }];
    const tools: ToolDefinition[] = [{
      name: "web_search",
      description: "Search the web",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    }];

    const result = await provider.chat(messages, tools, undefined, (token) => {
      tokens.push(token);
    });

    expect(tokens).toEqual(["I'll search for that"]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("web_search");
    expect(result.toolCalls[0].arguments).toEqual({ query: "hello" });
    expect(result.finishReason).toBe("tool_use");
  });
});
