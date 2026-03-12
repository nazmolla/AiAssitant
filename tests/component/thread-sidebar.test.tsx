/**
 * Component interaction tests for ThreadSidebar.
 *
 * ThreadSidebar is a purely presentational component — thread list and all
 * callbacks are prop-driven. Tests verify that list items render correctly,
 * selection state is applied, and all click interactions fire the right
 * callback with the right arguments.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: { user: { email: "user@test.com", id: "u1" }, expires: "2099-01-01" },
    status: "authenticated",
  })),
}));

jest.mock("@mui/icons-material/Add", () => () => <span data-testid="AddIcon" />);
jest.mock("@mui/icons-material/DeleteOutline", () => () => <span data-testid="DeleteOutlineIcon" />);

import { ThreadSidebar, type ThreadSidebarProps } from "@/components/thread-sidebar";
import type { Thread } from "@/components/chat-panel-types";

// ── Helpers ──────────────────────────────────────────────────────

function makeThread(id: string, title: string, status: string = "idle"): Thread {
  return { id, title, status, last_message_at: "2025-01-01T00:00:00Z" };
}

function baseProps(overrides: Partial<ThreadSidebarProps> = {}): ThreadSidebarProps {
  return {
    threads: [],
    threadsTotal: 0,
    threadsHasMore: false,
    activeThread: null,
    showSidebar: true,
    onSelectThread: jest.fn(),
    onCreateThread: jest.fn(),
    onDeleteThread: jest.fn(),
    onLoadMore: jest.fn(),
    ...overrides,
  };
}

function renderSidebar(overrides: Partial<ThreadSidebarProps> = {}) {
  const props = baseProps(overrides);
  render(<ThreadSidebar {...props} />);
  return props;
}

// ════════════════════════════════════════════════════════════════
// 1. RENDER — basic structure
// ════════════════════════════════════════════════════════════════

describe("ThreadSidebar — rendering", () => {
  test("renders without throwing with empty thread list", () => {
    expect(() => renderSidebar()).not.toThrow();
  });

  test("New Thread button is visible", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: /new thread/i })).toBeInTheDocument();
  });

  test("renders thread titles", () => {
    renderSidebar({
      threads: [makeThread("t1", "Thread Alpha"), makeThread("t2", "Thread Beta")],
      threadsTotal: 2,
    });
    expect(screen.getByText("Thread Alpha")).toBeInTheDocument();
    expect(screen.getByText("Thread Beta")).toBeInTheDocument();
  });

  test("renders thread status chip", () => {
    renderSidebar({
      threads: [makeThread("t1", "Active Thread", "active")],
      threadsTotal: 1,
    });
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  test("renders 'awaiting_approval' status chip", () => {
    renderSidebar({
      threads: [makeThread("t1", "Pending Thread", "awaiting_approval")],
      threadsTotal: 1,
    });
    expect(screen.getByText("awaiting_approval")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 2. THREAD SELECTION
// ════════════════════════════════════════════════════════════════

describe("ThreadSidebar — thread selection", () => {
  test("clicking a thread calls onSelectThread with that thread's id", () => {
    const props = renderSidebar({
      threads: [makeThread("t1", "Thread One"), makeThread("t2", "Thread Two")],
      threadsTotal: 2,
    });
    fireEvent.click(screen.getByText("Thread One"));
    expect(props.onSelectThread).toHaveBeenCalledWith("t1");
  });

  test("clicking a different thread calls onSelectThread with the correct id", () => {
    const props = renderSidebar({
      threads: [makeThread("t1", "Thread One"), makeThread("t2", "Thread Two")],
      threadsTotal: 2,
    });
    fireEvent.click(screen.getByText("Thread Two"));
    expect(props.onSelectThread).toHaveBeenCalledWith("t2");
  });

  test("onSelectThread is called exactly once per click", () => {
    const props = renderSidebar({
      threads: [makeThread("t1", "Thread One")],
      threadsTotal: 1,
    });
    fireEvent.click(screen.getByText("Thread One"));
    expect(props.onSelectThread).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════
// 3. CREATE THREAD
// ════════════════════════════════════════════════════════════════

describe("ThreadSidebar — create thread", () => {
  test("clicking New Thread button calls onCreateThread", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /new thread/i }));
    expect(props.onCreateThread).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════
// 4. DELETE THREAD
// ════════════════════════════════════════════════════════════════

describe("ThreadSidebar — delete thread", () => {
  test("clicking the delete icon on a thread calls onDeleteThread with the correct id", () => {
    const props = renderSidebar({
      threads: [makeThread("t1", "Thread One")],
      threadsTotal: 1,
    });
    // Delete icon buttons — each thread has one
    const deleteButtons = screen.getAllByTestId("DeleteOutlineIcon").map(
      (icon) => icon.closest("button") as HTMLButtonElement
    );
    fireEvent.click(deleteButtons[0]);
    expect(props.onDeleteThread).toHaveBeenCalledWith("t1");
  });

  test("clicking delete icon does NOT call onSelectThread", () => {
    const props = renderSidebar({
      threads: [makeThread("t1", "Thread One")],
      threadsTotal: 1,
    });
    const deleteButton = screen.getByTestId("DeleteOutlineIcon").closest("button") as HTMLButtonElement;
    fireEvent.click(deleteButton);
    expect(props.onSelectThread).not.toHaveBeenCalled();
  });

  test("clicking delete icon on the second thread calls onDeleteThread with its id", () => {
    const props = renderSidebar({
      threads: [makeThread("t1", "Thread One"), makeThread("t2", "Thread Two")],
      threadsTotal: 2,
    });
    const deleteButtons = screen.getAllByTestId("DeleteOutlineIcon").map(
      (icon) => icon.closest("button") as HTMLButtonElement
    );
    fireEvent.click(deleteButtons[1]);
    expect(props.onDeleteThread).toHaveBeenCalledWith("t2");
    expect(props.onDeleteThread).not.toHaveBeenCalledWith("t1");
  });
});

// ════════════════════════════════════════════════════════════════
// 5. LOAD MORE
// ════════════════════════════════════════════════════════════════

describe("ThreadSidebar — load more", () => {
  test("Load more button is NOT shown when threadsHasMore is false", () => {
    renderSidebar({
      threads: [makeThread("t1", "Thread One")],
      threadsTotal: 1,
      threadsHasMore: false,
    });
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  test("Load more button IS shown when threadsHasMore is true", () => {
    renderSidebar({
      threads: [makeThread("t1", "Thread One")],
      threadsTotal: 5,
      threadsHasMore: true,
    });
    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();
  });

  test("Load more button shows remaining count", () => {
    renderSidebar({
      threads: [makeThread("t1", "Thread One")],
      threadsTotal: 5,
      threadsHasMore: true,
    });
    expect(screen.getByText(/4 remaining/)).toBeInTheDocument();
  });

  test("clicking Load more calls onLoadMore", () => {
    const props = renderSidebar({
      threads: [makeThread("t1", "Thread One")],
      threadsTotal: 5,
      threadsHasMore: true,
    });
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════
// 6. EMPTY STATE
// ════════════════════════════════════════════════════════════════

describe("ThreadSidebar — empty thread list", () => {
  test("renders without error when threads array is empty", () => {
    expect(() =>
      renderSidebar({ threads: [], threadsTotal: 0, threadsHasMore: false })
    ).not.toThrow();
  });

  test("no thread items are rendered when list is empty", () => {
    renderSidebar({ threads: [], threadsTotal: 0, threadsHasMore: false });
    expect(screen.queryByText("active")).not.toBeInTheDocument();
    expect(screen.queryByText("idle")).not.toBeInTheDocument();
  });
});
