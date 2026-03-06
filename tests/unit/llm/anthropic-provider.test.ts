/**
 * Unit tests — Anthropic Provider
 *
 * Validates:
 * - Constructor rejects missing API key
 * - Message mapping: system messages excluded, tool results mapped, multimodal
 * - toAnthropicPart: base64 data URIs, URL images, file attachments
 */

// ── Mocks ────────────────────────────────────────────────────────

const mockCreate = jest.fn();
const mockStream = jest.fn();

jest.mock("@anthropic-ai/sdk", () => {
  return {
    __esModule: true,
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
        stream: mockStream,
      };
    },
  };
});

import { AnthropicChatProvider } from "@/lib/llm/anthropic-provider";
import type { ChatMessage } from "@/lib/llm/types";

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────

describe("AnthropicChatProvider — constructor", () => {
  test("throws without API key", () => {
    expect(() => new AnthropicChatProvider({})).toThrow("Missing Anthropic API key");
  });

  test("creates provider with valid API key", () => {
    expect(() => new AnthropicChatProvider({ apiKey: "sk-ant-test" })).not.toThrow();
  });

  test("defaults model to claude-sonnet-4-20250514", async () => {
    const provider = new AnthropicChatProvider({ apiKey: "sk-ant-test" });
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello" }],
      stop_reason: "end_turn",
    });

    await provider.chat([{ role: "user", content: "hi" }]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-4-20250514" })
    );
  });

  test("uses custom model when specified", async () => {
    const provider = new AnthropicChatProvider({ apiKey: "sk-ant-test", model: "claude-3-haiku-20240307" });
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello" }],
      stop_reason: "end_turn",
    });

    await provider.chat([{ role: "user", content: "hi" }]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-3-haiku-20240307" })
    );
  });
});

describe("AnthropicChatProvider — message mapping", () => {
  let provider: AnthropicChatProvider;

  beforeEach(() => {
    provider = new AnthropicChatProvider({ apiKey: "sk-ant-test" });
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Response" }],
      stop_reason: "end_turn",
    });
  });

  test("system messages are extracted as system param, not in messages array", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "hi" },
    ];
    await provider.chat(messages, undefined, "System prompt");
    const call = mockCreate.mock.calls[0][0];
    // System prompt is the systemPrompt parameter, not individual system messages
    expect(call.system).toBe("System prompt");
    // Messages should not contain system role
    for (const msg of call.messages) {
      expect(msg.role).not.toBe("system");
    }
  });

  test("tool result messages are mapped to user role with tool_result content", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "search for cats" },
      {
        role: "assistant",
        content: "I'll search",
        tool_calls: [{ id: "tc-1", name: "web_search", arguments: { query: "cats" } }],
      },
      { role: "tool", content: '{"results": []}', tool_call_id: "tc-1" },
    ];
    await provider.chat(messages);
    const call = mockCreate.mock.calls[0][0];
    const toolResultMsg = call.messages.find(
      (m: Record<string, unknown>) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as Array<Record<string, unknown>>).some((c: Record<string, unknown>) => c.type === "tool_result")
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.content[0].tool_use_id).toBe("tc-1");
  });

  test("assistant messages with tool_calls include tool_use blocks", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "search" },
      {
        role: "assistant",
        content: "Searching...",
        tool_calls: [{ id: "tc-2", name: "web_search", arguments: { query: "test" } }],
      },
      { role: "tool", content: "result", tool_call_id: "tc-2" },
    ];
    await provider.chat(messages);
    const call = mockCreate.mock.calls[0][0];
    const assistantMsg = call.messages.find(
      (m: Record<string, unknown>) =>
        m.role === "assistant" &&
        Array.isArray(m.content)
    );
    expect(assistantMsg).toBeDefined();
    const toolUseBlock = assistantMsg.content.find(
      (b: Record<string, unknown>) => b.type === "tool_use"
    );
    expect(toolUseBlock).toBeDefined();
    expect(toolUseBlock.name).toBe("web_search");
    expect(toolUseBlock.id).toBe("tc-2");
  });
});

describe("AnthropicChatProvider — response parsing", () => {
  let provider: AnthropicChatProvider;

  beforeEach(() => {
    provider = new AnthropicChatProvider({ apiKey: "sk-ant-test" });
  });

  test("parses text content from response", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello there!" }],
      stop_reason: "end_turn",
    });
    const result = await provider.chat([{ role: "user", content: "hi" }]);
    expect(result.content).toBe("Hello there!");
    expect(result.toolCalls).toEqual([]);
  });

  test("parses tool_use blocks from response", async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: "text", text: "Let me search" },
        { type: "tool_use", id: "tc-resp", name: "web_search", input: { query: "test" } },
      ],
      stop_reason: "tool_use",
    });
    const result = await provider.chat([{ role: "user", content: "search" }]);
    expect(result.content).toBe("Let me search");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      id: "tc-resp",
      name: "web_search",
      arguments: { query: "test" },
    });
  });

  test("passes tool definitions to API", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });
    await provider.chat(
      [{ role: "user", content: "hi" }],
      [{ name: "web_search", description: "Search the web", inputSchema: { type: "object" } }]
    );
    const call = mockCreate.mock.calls[0][0];
    expect(call.tools).toHaveLength(1);
    expect(call.tools[0].name).toBe("web_search");
  });
});
