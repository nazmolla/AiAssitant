/**
 * Component interaction tests — ChatArea inline approval flow.
 *
 * Tests cover:
 * - Approve and Deny buttons are rendered when approval is pending
 * - Clicking Approve calls onApproval(approvalId, "approved")
 * - Clicking Deny calls onApproval(approvalId, "rejected")
 * - Resolved approval shows chip ("✓ Approved") instead of buttons
 * - Approve/Deny buttons are disabled when actingApproval === approvalId
 *
 * @jest-environment jsdom
 */
import "../helpers/setup-jsdom";
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

// TanStack Virtual — return all items as a flat list (no scrolling virtualisation in tests)
jest.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, getScrollElement }: { count: number; getScrollElement: () => HTMLElement | null }) => {
    void getScrollElement;
    return {
      getVirtualItems: () =>
        Array.from({ length: count }, (_, i) => ({ index: i, start: i * 120, key: `v-${i}` })),
      getTotalSize: () => count * 120,
      scrollToIndex: jest.fn(),
      measure: jest.fn(),
      measureElement: jest.fn(),
    };
  },
}));

// theme-provider — only formatDate is used by ChatArea
jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    formatDate: (s: string, _options?: Intl.DateTimeFormatOptions) => s,
  }),
}));

// MarkdownMessage — simplified stub
jest.mock("@/components/markdown-message", () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <span data-testid="markdown">{content}</span>,
}));

import { ChatArea, type ChatAreaProps } from "@/components/chat-area";
import type { ProcessedMessage } from "@/components/chat-panel-types";

// ── Test data ────────────────────────────────────────────────────

const APPROVAL_ID = "approval-test-123";

const approvalMessage: ProcessedMessage = {
  msg: {
    id: 10,
    thread_id: "thread-1",
    role: "system",
    content: "Approval needed",
    tool_calls: null,
    tool_results: null,
    attachments: null,
    created_at: "2024-01-01T00:00:00Z",
  },
  attachments: [],
  approvalMeta: {
    approvalId: APPROVAL_ID,
    tool_name: "builtin.web_search",
    args: { query: "test query" },
    reasoning: "Need to search for something",
  },
  displayContent: "Approval needed to continue.",
  thoughts: [],
};

function makeDefaultProps(overrides: Partial<ChatAreaProps> = {}): ChatAreaProps {
  return {
    processedMessages: [approvalMessage],
    loading: false,
    thinkingSteps: [],
    activeThread: "thread-1",
    activeThreadTitle: "Test Thread",
    showSidebar: false,
    userName: "Test User",
    playingTtsId: null,
    onPlayTts: jest.fn(),
    actingApproval: null,
    resolvedApprovals: {},
    onApproval: jest.fn(),
    onRestoreToMessage: jest.fn(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe("ChatArea — inline approval flow", () => {
  test("renders Approve and Deny buttons when approval is pending", () => {
    render(<ChatArea {...makeDefaultProps()} />);

    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });

  test("clicking Approve calls onApproval(approvalId, 'approved')", () => {
    const onApproval = jest.fn();
    render(<ChatArea {...makeDefaultProps({ onApproval })} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    expect(onApproval).toHaveBeenCalledWith(APPROVAL_ID, "approved");
  });

  test("clicking Deny calls onApproval(approvalId, 'rejected')", () => {
    const onApproval = jest.fn();
    render(<ChatArea {...makeDefaultProps({ onApproval })} />);

    fireEvent.click(screen.getByRole("button", { name: /deny/i }));

    expect(onApproval).toHaveBeenCalledWith(APPROVAL_ID, "rejected");
  });

  test("shows '✓ Approved' chip when approval is resolved='approved'", () => {
    render(
      <ChatArea
        {...makeDefaultProps({
          resolvedApprovals: { [APPROVAL_ID]: "approved" },
        })}
      />
    );

    expect(screen.getByText(/✓ Approved/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /deny/i })).not.toBeInTheDocument();
  });

  test("Approve and Deny buttons are disabled when actingApproval === approvalId", () => {
    render(
      <ChatArea
        {...makeDefaultProps({
          actingApproval: APPROVAL_ID,
        })}
      />
    );

    const approveBtn = screen.getByRole("button", { name: /processing/i });
    const denyBtn = screen.getByRole("button", { name: /deny/i });

    expect(approveBtn).toBeDisabled();
    expect(denyBtn).toBeDisabled();
  });
});
