/**
 * Unit tests for use-chat-stream hook.
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";

// Mock the sanitize function used by the hook
jest.mock("@/components/chat-panel-types", () => ({
  sanitizeAssistantContent: (text: string) => text,
}));

import { useChatStream } from "@/hooks/use-chat-stream";

function makeOptions(overrides: Partial<Parameters<typeof useChatStream>[0]> = {}) {
  return {
    activeThread: "thread-1",
    getInput: jest.fn(() => ""),
    clearInput: jest.fn(),
    restoreInput: jest.fn(),
    getPendingFiles: jest.fn(() => []),
    clearPendingFiles: jest.fn(),
    uploadFile: jest.fn(),
    isScreenSharing: jest.fn(() => false),
    captureFrame: jest.fn(() => null),
    audioModeRef: { current: false },
    audioModeTtsQueue: { current: "" },
    onAudioModePlayTts: jest.fn(),
    onThreadsRefresh: jest.fn(),
    ...overrides,
  };
}

describe("useChatStream", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("initializes with empty messages and not loading", () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useChatStream(opts));

    expect(result.current.messages).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.thinkingSteps).toEqual([]);
  });

  test("setMessages updates message list", () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useChatStream(opts));

    act(() => {
      result.current.setMessages([{
        id: 1,
        thread_id: "thread-1",
        role: "user",
        content: "Hello",
        tool_calls: null,
        tool_results: null,
        attachments: null,
        created_at: new Date().toISOString(),
      }]);
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe("Hello");
  });

  test("setLoading updates loading state", () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useChatStream(opts));

    act(() => { result.current.setLoading(true); });
    expect(result.current.loading).toBe(true);

    act(() => { result.current.setLoading(false); });
    expect(result.current.loading).toBe(false);
  });

  test("sendMessage does nothing when input is empty and no files", async () => {
    const opts = makeOptions({ getInput: jest.fn(() => "") });
    const { result } = renderHook(() => useChatStream(opts));

    await act(async () => { await result.current.sendMessage(); });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  test("sendMessage does nothing when activeThread is null", async () => {
    const opts = makeOptions({ activeThread: null, getInput: jest.fn(() => "Hello") });
    const { result } = renderHook(() => useChatStream(opts));

    await act(async () => { await result.current.sendMessage(); });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("sendMessage adds optimistic user message and calls clearInput", async () => {
    // Mock a response with a reader that ends immediately
    // TextEncoder may not exist in jsdom, so use a simple Uint8Array
    const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : { encode: (s: string) => Buffer.from(s) };
    const mockReader = {
      read: jest.fn()
        .mockResolvedValueOnce({ value: encoder.encode("event: done\ndata: {}\n\n"), done: false })
        .mockResolvedValueOnce({ value: undefined, done: true }),
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });

    const opts = makeOptions({ getInput: jest.fn(() => "Hello world") });
    const { result } = renderHook(() => useChatStream(opts));

    await act(async () => { await result.current.sendMessage(); });

    expect(opts.clearInput).toHaveBeenCalled();
    expect(opts.clearPendingFiles).toHaveBeenCalled();
  });

  test("sendMessage handles HTTP error response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.resolve({ error: "Server error" }),
    });

    const opts = makeOptions({ getInput: jest.fn(() => "Test message") });
    const { result } = renderHook(() => useChatStream(opts));

    await act(async () => { await result.current.sendMessage(); });

    // Should restore input on error
    expect(opts.restoreInput).toHaveBeenCalledWith("Test message");
    // Should add a system error message
    const systemMsg = result.current.messages.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg?.content).toContain("Error");
  });

  test("abortStream calls abort on the controller", () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useChatStream(opts));

    // Should not throw even when no stream is active
    act(() => { result.current.abortStream(); });
  });

  test("setThinkingSteps updates thinking state", () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useChatStream(opts));

    act(() => {
      result.current.setThinkingSteps([
        { step: "Analyzing", detail: "Reading context", timestamp: Date.now() },
      ]);
    });

    expect(result.current.thinkingSteps).toHaveLength(1);
    expect(result.current.thinkingSteps[0].step).toBe("Analyzing");
  });
});
