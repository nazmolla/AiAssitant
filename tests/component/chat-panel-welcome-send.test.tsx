/**
 * Component interaction tests for ChatPanel — welcome screen send flow.
 *
 * Specifically tests the bug where sending from the welcome state (no active
 * thread) created an empty thread with no message, due to requestAnimationFrame
 * firing before React flushed the new activeThread into the sendMessage closure,
 * or the useEffect fetch wiping the optimistic message.
 *
 * Tests:
 * - Typing and pressing Enter on the welcome screen calls POST /api/threads
 *   and then POST /api/threads/:id/chat with the correct thread ID.
 * - The optimistic user message appears in the UI immediately after send.
 * - Clicking the Send button also triggers the create-then-send flow.
 * - Empty input on welcome screen does NOT create a thread.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Navigation / Auth mocks ────────────────────────────────────────────────

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: { user: { email: "user@test.com", id: "u1", role: "user", name: "Test User" }, expires: "2099-01-01" },
    status: "authenticated",
  })),
}));

// ── Child component stubs ──────────────────────────────────────────────────

// ThreadSidebar — only renders a stub so we isolate ChatPanel logic
jest.mock("@/components/thread-sidebar", () => ({
  ThreadSidebar: () => <div data-testid="thread-sidebar" />,
}));

// ChatArea — render message content so we can assert optimistic messages appear
jest.mock("@/components/chat-area", () => ({
  ChatArea: ({
    processedMessages,
    activeThread,
  }: {
    processedMessages?: Array<{ msg: { id: number; role: string; content: string | null }; displayContent: string | null }>;
    activeThread: string | null;
  }) => (
    <div data-testid="chat-area">
      {!activeThread && <div data-testid="welcome-screen">Where should we start?</div>}
      {(processedMessages ?? []).map((pm) => (
        <div key={pm.msg.id} data-testid={`msg-${pm.msg.role}`}>{pm.displayContent ?? pm.msg.content}</div>
      ))}
    </div>
  ),
}));

// InputBar — render a real textarea + send button so we can fire events
jest.mock("@/components/input-bar", () => ({
  InputBar: ({
    input,
    onInputChange,
    onSendMessage,
    loading,
  }: {
    input: string;
    onInputChange: (v: string) => void;
    onSendMessage: () => void;
    loading: boolean;
  }) => (
    <div data-testid="input-bar">
      <textarea
        data-testid="chat-input"
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSendMessage(); } }}
        disabled={loading}
      />
      <button data-testid="send-btn" onClick={onSendMessage} disabled={loading}>Send</button>
    </div>
  ),
}));

// ── Hook stubs ────────────────────────────────────────────────────────────

jest.mock("@/hooks/use-screen-share", () => ({
  useScreenShare: () => ({
    isScreenSharing: false,
    captureFrame: () => null,
    startSharing: jest.fn(),
    stopSharing: jest.fn(),
    latestFrameRef: { current: null },
    frameImgRef: { current: null },
  }),
}));

jest.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({
    pendingFiles: [],
    setPendingFiles: jest.fn(),
    addFiles: jest.fn(),
    removeFile: jest.fn(),
    uploadFile: jest.fn(),
    clearPendingFiles: jest.fn(),
    fileInputRef: { current: null },
    getPendingFiles: () => [],
    clearFiles: jest.fn(),
  }),
}));

jest.mock("@/hooks/use-audio-controls", () => ({
  useAudioControls: () => ({
    recording: false,
    transcribing: false,
    audioMode: false,
    playingTtsId: null,
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    toggleAudioMode: jest.fn(),
    playTts: jest.fn(),
    audioModePlayTts: jest.fn(),
    audioModeRef: { current: false },
    audioModeSpeaking: { current: false },
    audioModeTtsQueue: { current: "" },
  }),
}));

// theme-provider
jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "light", setTheme: jest.fn(), formatDate: (s: string) => s }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// notification-bell
jest.mock("@/components/notification-bell", () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

// ── Import component under test ────────────────────────────────────────────

import { ChatPanel } from "@/components/chat-panel";

// ── Helpers ────────────────────────────────────────────────────────────────

const THREAD_ID = "thread-abc-123";

/** Build an SSE stream that sends done immediately */
function makeSseStream() {
  const enc = new TextEncoder();
  const chunk = enc.encode("event: done\ndata: {}\n\n");
  let called = 0;
  return {
    getReader: () => ({
      read: jest.fn(() => {
        called++;
        if (called === 1) return Promise.resolve({ value: chunk, done: false });
        return Promise.resolve({ value: undefined, done: true });
      }),
    }),
  };
}

function setupFetchMock() {
  (global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
    // GET /api/threads — list threads (initial load)
    if (url === "/api/threads" && (!opts?.method || opts.method === "GET")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [], total: 0 }) });
    }
    // POST /api/threads — create new thread
    if (url === "/api/threads" && opts?.method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: THREAD_ID, title: "New Thread", user_id: "u1", created_at: new Date().toISOString(), status: "active" }),
      });
    }
    // POST /api/threads/:id/chat — send message (SSE stream)
    if (url === `/api/threads/${THREAD_ID}/chat` && opts?.method === "POST") {
      return Promise.resolve({ ok: true, body: makeSseStream() });
    }
    // GET /api/threads/:id — load thread messages (should NOT be called for fresh thread)
    if (typeof url === "string" && url.match(/\/api\/threads\/[^/]+$/) && (!opts?.method || opts.method === "GET")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ messages: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ChatPanel — welcome screen send flow", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.clearAllMocks();
    setupFetchMock();
  });

  test("renders welcome screen when no thread is active", async () => {
    await act(async () => { render(<ChatPanel />); });
    expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
  });

  test("typing a message and pressing Enter creates a thread and sends the message", async () => {
    await act(async () => { render(<ChatPanel />); });

    const input = screen.getByTestId("chat-input");

    // Type a message
    await act(async () => {
      fireEvent.change(input, { target: { value: "Hello from welcome screen" } });
    });

    // Press Enter to send
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    });

    // Wait for async operations (createThread + sendMessage)
    await waitFor(() => {
      // POST /api/threads must have been called to create a thread
      const createCall = (global.fetch as jest.Mock).mock.calls.find(
        ([url, opts]) => url === "/api/threads" && opts?.method === "POST"
      );
      expect(createCall).toBeDefined();
    });

    await waitFor(() => {
      // POST /api/threads/:id/chat must be called with the new thread ID
      const chatCall = (global.fetch as jest.Mock).mock.calls.find(
        ([url, opts]) => url === `/api/threads/${THREAD_ID}/chat` && opts?.method === "POST"
      );
      expect(chatCall).toBeDefined();
    });
  });

  test("clicking Send button creates a thread and sends the message", async () => {
    await act(async () => { render(<ChatPanel />); });

    const input = screen.getByTestId("chat-input");
    const sendBtn = screen.getByTestId("send-btn");

    await act(async () => {
      fireEvent.change(input, { target: { value: "Button send test" } });
    });

    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() => {
      const chatCall = (global.fetch as jest.Mock).mock.calls.find(
        ([url, opts]) => url === `/api/threads/${THREAD_ID}/chat` && opts?.method === "POST"
      );
      expect(chatCall).toBeDefined();
    });
  });

  test("empty input on welcome screen does NOT create a thread", async () => {
    await act(async () => { render(<ChatPanel />); });

    const sendBtn = screen.getByTestId("send-btn");

    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await new Promise((r) => setTimeout(r, 100));

    const createCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url, opts]) => url === "/api/threads" && opts?.method === "POST"
    );
    expect(createCall).toBeUndefined();
  });

  test("chat API is called with the new thread ID, not null", async () => {
    await act(async () => { render(<ChatPanel />); });

    const input = screen.getByTestId("chat-input");

    await act(async () => {
      fireEvent.change(input, { target: { value: "Test message" } });
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    });

    await waitFor(() => {
      const chatCall = (global.fetch as jest.Mock).mock.calls.find(
        ([url, opts]) => url === `/api/threads/${THREAD_ID}/chat` && opts?.method === "POST"
      );
      expect(chatCall).toBeDefined();
      // Verify the request body contains the message
      const body = JSON.parse(chatCall[1].body);
      expect(body.message).toBe("Test message");
    });
  });

  test("optimistic user message appears in the UI immediately after send", async () => {
    await act(async () => { render(<ChatPanel />); });

    const input = screen.getByTestId("chat-input");

    await act(async () => {
      fireEvent.change(input, { target: { value: "Optimistic message" } });
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    });

    await waitFor(() => {
      const userMessages = screen.queryAllByTestId("msg-user");
      const found = userMessages.some((el) => el.textContent === "Optimistic message");
      expect(found).toBe(true);
    }, { timeout: 3000 });
  });
});
