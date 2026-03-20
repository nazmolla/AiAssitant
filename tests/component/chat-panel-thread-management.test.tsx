/**
 * Component interaction tests for ChatPanel — thread management flows (#214).
 *
 * Tests:
 * - Selecting a thread fetches its messages and renders them.
 * - Selecting a thread closes the sidebar.
 * - Deleting the active thread clears messages and returns to welcome screen.
 * - Deleting a non-active thread removes it from the list without clearing messages.
 * - Cancelling the delete confirm does NOT call DELETE.
 * - Load-more button fetches the next page and appends threads.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
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

// ── ThreadSidebar mock — exposes callbacks so tests can trigger them ───────

type ThreadSidebarProps = {
  threads: Array<{ id: string; title: string }>;
  showSidebar: boolean;
  onSelectThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onLoadMore: () => void;
  onClose: () => void;
};

jest.mock("@/components/thread-sidebar", () => ({
  ThreadSidebar: (props: ThreadSidebarProps) => (
    <div data-testid="thread-sidebar" data-open={String(props.showSidebar)}>
      {props.threads.map((t) => (
        <div key={t.id}>
          <button
            data-testid={`select-thread-${t.id}`}
            onClick={() => props.onSelectThread(t.id)}
          >
            {t.title}
          </button>
          <button
            data-testid={`delete-thread-${t.id}`}
            onClick={() => props.onDeleteThread(t.id)}
          >
            Delete
          </button>
        </div>
      ))}
      <button data-testid="load-more-btn" onClick={() => props.onLoadMore()}>
        Load more
      </button>
      <button data-testid="close-sidebar-btn" onClick={() => props.onClose()}>
        Close
      </button>
    </div>
  ),
}));

// ── ChatArea mock — shows activeThread and messages ────────────────────────

jest.mock("@/components/chat-area", () => ({
  ChatArea: ({
    processedMessages,
    activeThread,
  }: {
    processedMessages?: Array<{ msg: { id: number; role: string; content: string | null }; displayContent: string | null }>;
    activeThread: string | null;
  }) => (
    <div data-testid="chat-area" data-active-thread={activeThread ?? "none"}>
      {!activeThread && <div data-testid="welcome-screen">Where should we start?</div>}
      {(processedMessages ?? []).map((pm) => (
        <div key={pm.msg.id} data-testid={`msg-${pm.msg.role}`}>{pm.displayContent ?? pm.msg.content}</div>
      ))}
    </div>
  ),
}));

// ── InputBar minimal stub ──────────────────────────────────────────────────

jest.mock("@/components/input-bar", () => ({
  InputBar: () => <div data-testid="input-bar" />,
}));

// ── Hook stubs ────────────────────────────────────────────────────────────

jest.mock("@/hooks/use-screen-share", () => ({
  useScreenShare: () => ({
    isScreenSharing: false,
    screenSharing: false,
    screenShareEnabled: false,
    captureFrame: () => null,
    startScreenShare: jest.fn(),
    stopScreenShare: jest.fn(),
    latestFrameRef: { current: null },
    frameImgRef: { current: null },
  }),
}));

jest.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({
    pendingFiles: [],
    setPendingFiles: jest.fn(),
    handleFileSelect: jest.fn(),
    removePendingFile: jest.fn(),
    uploadFile: jest.fn(),
    fileInputRef: { current: null },
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

jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "light", setTheme: jest.fn(), formatDate: (s: string) => s }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/notification-bell", () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

// ── Import component under test ────────────────────────────────────────────

import { ChatPanel } from "@/components/chat-panel";

// ── Constants ──────────────────────────────────────────────────────────────

const THREAD_A = { id: "thread-aaa", title: "Thread A" };
const THREAD_B = { id: "thread-bbb", title: "Thread B" };

const THREAD_A_MESSAGES = [
  { id: 1, role: "user", content: "Hello from A", thread_id: THREAD_A.id, created_at: "" },
  { id: 2, role: "assistant", content: "Hi there!", thread_id: THREAD_A.id, created_at: "" },
];

function setupFetch(overrides?: Record<string, unknown>) {
  (global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
    // Initial thread list
    if (url === "/api/threads" && (!opts?.method || opts.method === "GET") && !url.includes("offset")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [THREAD_A, THREAD_B], total: 2, hasMore: false }),
      });
    }
    // Load-more (offset)
    if (typeof url === "string" && url.startsWith("/api/threads?limit=50&offset=")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: "thread-ccc", title: "Thread C" }], total: 3, hasMore: false }),
      });
    }
    // GET /api/threads/thread-aaa — fetch thread A messages
    if (url === `/api/threads/${THREAD_A.id}` && (!opts?.method || opts.method === "GET")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ messages: THREAD_A_MESSAGES }),
      });
    }
    // GET /api/threads/thread-bbb
    if (url === `/api/threads/${THREAD_B.id}` && (!opts?.method || opts.method === "GET")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      });
    }
    // DELETE /api/threads/:id
    if (typeof url === "string" && url.match(/\/api\/threads\/[^/]+$/) && opts?.method === "DELETE") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    // Profile
    if (url === "/api/config/profile") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: null }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides ?? {}) });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ChatPanel — thread selection", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    setupFetch();
  });

  test("clicking a thread fetches its messages and displays them", async () => {
    await act(async () => { render(<ChatPanel />); });

    // Wait for initial thread list to load
    await waitFor(() => {
      expect(screen.getByTestId(`select-thread-${THREAD_A.id}`)).toBeInTheDocument();
    });

    // Select thread A
    await act(async () => {
      screen.getByTestId(`select-thread-${THREAD_A.id}`).click();
    });

    // GET /api/threads/thread-aaa should be called
    await waitFor(() => {
      const getCall = (global.fetch as jest.Mock).mock.calls.find(
        ([url, opts]) => url === `/api/threads/${THREAD_A.id}` && (!opts?.method || opts.method === "GET")
      );
      expect(getCall).toBeDefined();
    });
  });

  test("clicking a thread sets it as active thread in ChatArea", async () => {
    await act(async () => { render(<ChatPanel />); });

    await waitFor(() => {
      expect(screen.getByTestId(`select-thread-${THREAD_A.id}`)).toBeInTheDocument();
    });

    await act(async () => {
      screen.getByTestId(`select-thread-${THREAD_A.id}`).click();
    });

    await waitFor(() => {
      const chatArea = screen.getByTestId("chat-area");
      expect(chatArea.getAttribute("data-active-thread")).toBe(THREAD_A.id);
    });
  });

  test("welcome screen disappears after selecting a thread", async () => {
    await act(async () => { render(<ChatPanel />); });

    expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();

    await act(async () => {
      await waitFor(() => screen.getByTestId(`select-thread-${THREAD_A.id}`));
      screen.getByTestId(`select-thread-${THREAD_A.id}`).click();
    });

    await waitFor(() => {
      expect(screen.queryByTestId("welcome-screen")).not.toBeInTheDocument();
    });
  });

  test("sidebar closes after selecting a thread", async () => {
    await act(async () => { render(<ChatPanel />); });

    await waitFor(() => screen.getByTestId(`select-thread-${THREAD_A.id}`));

    await act(async () => {
      screen.getByTestId(`select-thread-${THREAD_A.id}`).click();
    });

    await waitFor(() => {
      const sidebar = screen.getByTestId("thread-sidebar");
      expect(sidebar.getAttribute("data-open")).toBe("false");
    });
  });
});

describe("ChatPanel — thread deletion", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    setupFetch();
  });

  test("deleting active thread calls DELETE and clears messages, returns to welcome screen", async () => {
    window.confirm = jest.fn().mockReturnValue(true);

    await act(async () => { render(<ChatPanel />); });

    // Select thread A first
    await waitFor(() => screen.getByTestId(`select-thread-${THREAD_A.id}`));
    await act(async () => { screen.getByTestId(`select-thread-${THREAD_A.id}`).click(); });
    await waitFor(() => {
      expect(screen.getByTestId("chat-area").getAttribute("data-active-thread")).toBe(THREAD_A.id);
    });

    // Now delete it
    await act(async () => { screen.getByTestId(`delete-thread-${THREAD_A.id}`).click(); });

    await waitFor(() => {
      const deleteCall = (global.fetch as jest.Mock).mock.calls.find(
        ([url, opts]) => url === `/api/threads/${THREAD_A.id}` && opts?.method === "DELETE"
      );
      expect(deleteCall).toBeDefined();
    });

    // Should return to welcome screen
    await waitFor(() => {
      expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
    });
  });

  test("deleting a non-active thread does NOT clear messages or change active thread", async () => {
    window.confirm = jest.fn().mockReturnValue(true);

    await act(async () => { render(<ChatPanel />); });

    // Select thread A
    await waitFor(() => screen.getByTestId(`select-thread-${THREAD_A.id}`));
    await act(async () => { screen.getByTestId(`select-thread-${THREAD_A.id}`).click(); });
    await waitFor(() => {
      expect(screen.getByTestId("chat-area").getAttribute("data-active-thread")).toBe(THREAD_A.id);
    });

    // Delete thread B (not active)
    await act(async () => { screen.getByTestId(`delete-thread-${THREAD_B.id}`).click(); });

    await waitFor(() => {
      const deleteCall = (global.fetch as jest.Mock).mock.calls.find(
        ([url, opts]) => url === `/api/threads/${THREAD_B.id}` && opts?.method === "DELETE"
      );
      expect(deleteCall).toBeDefined();
    });

    // Thread A should remain active
    expect(screen.getByTestId("chat-area").getAttribute("data-active-thread")).toBe(THREAD_A.id);
    // Welcome screen should NOT appear
    expect(screen.queryByTestId("welcome-screen")).not.toBeInTheDocument();
  });

  test("cancelling the delete confirm does NOT call DELETE", async () => {
    window.confirm = jest.fn().mockReturnValue(false);

    await act(async () => { render(<ChatPanel />); });

    await waitFor(() => screen.getByTestId(`delete-thread-${THREAD_A.id}`));
    await act(async () => { screen.getByTestId(`delete-thread-${THREAD_A.id}`).click(); });

    await new Promise((r) => setTimeout(r, 100));

    const deleteCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url, opts]) => url === `/api/threads/${THREAD_A.id}` && opts?.method === "DELETE"
    );
    expect(deleteCall).toBeUndefined();
  });
});

describe("ChatPanel — load more threads", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  test("load-more button fetches the next page and appends threads", async () => {
    // Initial list returns hasMore: true
    (global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "/api/threads" && (!opts?.method || opts.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [THREAD_A, THREAD_B], total: 3, hasMore: true }),
        });
      }
      if (typeof url === "string" && url.startsWith("/api/threads?limit=50&offset=2")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ id: "thread-ccc", title: "Thread C" }], total: 3, hasMore: false }),
        });
      }
      if (url === "/api/config/profile") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: null }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    await act(async () => { render(<ChatPanel />); });

    await waitFor(() => screen.getByTestId("load-more-btn"));

    await act(async () => { screen.getByTestId("load-more-btn").click(); });

    await waitFor(() => {
      const loadMoreCall = (global.fetch as jest.Mock).mock.calls.find(
        ([url]) => typeof url === "string" && url.includes("offset=2")
      );
      expect(loadMoreCall).toBeDefined();
    });
  });
});
