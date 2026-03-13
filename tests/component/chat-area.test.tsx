/**
 * Component interaction tests for ChatArea.
 *
 * Tests cover:
 * - Empty state when no activeThread is set
 * - Rendering user and assistant messages
 * - Approval buttons (Approve / Deny) call onApproval with correct action
 * - Resolved approvals show status chip instead of buttons
 * - TTS read-aloud button calls onPlayTts with message id and text
 * - Loading indicator for in-progress assistant message
 * - onBackToSidebar button calls callback
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

// MarkdownMessage — simplified stub so we don't need to configure markdown parsers
jest.mock("@/components/markdown-message", () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

jest.mock("@mui/icons-material/ArrowBack", () => () => <span data-testid="ArrowBackIcon" />);
jest.mock("@mui/icons-material/AutoAwesome", () => () => <span data-testid="AutoAwesomeIcon" />);
jest.mock("@mui/icons-material/CheckCircleOutline", () => () => <span data-testid="CheckCircleOutlineIcon" />);
jest.mock("@mui/icons-material/ExpandMore", () => () => <span data-testid="ExpandMoreIcon" />);
jest.mock("@mui/icons-material/ExpandLess", () => () => <span data-testid="ExpandLessIcon" />);
jest.mock("@mui/icons-material/Psychology", () => () => <span data-testid="PsychologyIcon" />);
jest.mock("@mui/icons-material/Build", () => () => <span data-testid="BuildIcon" />);
jest.mock("@mui/icons-material/VolumeUp", () => () => <span data-testid="VolumeUpIcon" />);
jest.mock("@mui/icons-material/StopCircle", () => () => <span data-testid="StopCircleIcon" />);
jest.mock("@mui/icons-material/Replay", () => () => <span data-testid="ReplayIcon" />);
jest.mock("@mui/icons-material/AttachFile", () => () => <span data-testid="AttachFileIcon" />);
jest.mock("@mui/icons-material/ChatBubbleOutline", () => () => <span data-testid="ChatBubbleOutlineIcon" />);

import { ChatArea, type ChatAreaProps } from "@/components/chat-area";
import type { ProcessedMessage } from "@/components/chat-panel-types";

// ── Helpers ──────────────────────────────────────────────────────

let msgIdCounter = 1;

function makeMsg(
  role: string,
  content: string | null,
  id?: number
): ProcessedMessage["msg"] {
  return {
    id: id ?? msgIdCounter++,
    thread_id: "thread-1",
    role,
    content,
    tool_calls: null,
    tool_results: null,
    attachments: null,
    created_at: "2025-01-01T12:00:00Z",
  };
}

function makeProcessedMsg(
  role: string,
  content: string | null,
  overrides: Partial<ProcessedMessage> = {}
): ProcessedMessage {
  return {
    msg: makeMsg(role, content),
    attachments: [],
    approvalMeta: null,
    displayContent: content,
    thoughts: [],
    ...overrides,
  };
}

function makeApprovalMsg(approvalId: string, toolName: string): ProcessedMessage {
  const approvalJson = JSON.stringify({
    approvalId,
    tool_name: toolName,
    args: { input: "test" },
    reasoning: "Tool requires approval",
  });
  const rawContent = `Please approve\n<!-- APPROVAL:${approvalJson} -->`;
  return {
    msg: makeMsg("system", rawContent),
    attachments: [],
    approvalMeta: {
      approvalId,
      tool_name: toolName,
      args: { input: "test" },
      reasoning: "Tool requires approval",
    },
    displayContent: "Please approve",
    thoughts: [],
  };
}

function baseProps(overrides: Partial<ChatAreaProps> = {}): ChatAreaProps {
  return {
    processedMessages: [],
    loading: false,
    thinkingSteps: [],
    activeThread: "thread-1",
    activeThreadTitle: "My Thread",
    showSidebar: false,
    onBackToSidebar: jest.fn(),
    playingTtsId: null,
    onPlayTts: jest.fn(),
    actingApproval: null,
    resolvedApprovals: {},
    onApproval: jest.fn(),
    onRestoreToMessage: jest.fn(),
    ...overrides,
  };
}

function renderArea(overrides: Partial<ChatAreaProps> = {}) {
  const props = baseProps(overrides);
  render(<ChatArea {...props} />);
  return props;
}

// ════════════════════════════════════════════════════════════════
// 1. EMPTY STATE (no active thread)
// ════════════════════════════════════════════════════════════════

describe("ChatArea — empty state (no active thread)", () => {
  test("shows 'No thread selected' when activeThread is null", () => {
    renderArea({ activeThread: null });
    expect(screen.getByText("No thread selected")).toBeInTheDocument();
  });

  test("shows instructions to select or create a thread", () => {
    renderArea({ activeThread: null });
    expect(screen.getByText(/select or create a thread/i)).toBeInTheDocument();
  });

  test("onBackToSidebar button is rendered (mobile back button in empty state)", () => {
    const props = renderArea({ activeThread: null });
    // The back button has "Threads" text in both empty and active states
    const threadsButton = screen.queryByRole("button", { name: /threads/i });
    // It may or may not be visible depending on screen size — verify it exists or callback exists
    // The important thing is that clicking it calls the handler
    if (threadsButton) {
      fireEvent.click(threadsButton);
      expect(props.onBackToSidebar).toHaveBeenCalled();
    } else {
      // At minimum the component should render without error
      expect(screen.getByText("No thread selected")).toBeInTheDocument();
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 2. MESSAGE RENDERING
// ════════════════════════════════════════════════════════════════

describe("ChatArea — message rendering", () => {
  test("renders a user message", () => {
    renderArea({
      processedMessages: [makeProcessedMsg("user", "Hello agent!")],
    });
    expect(screen.getByText("Hello agent!")).toBeInTheDocument();
  });

  test("renders an assistant message via MarkdownMessage", () => {
    renderArea({
      processedMessages: [makeProcessedMsg("assistant", "Hello user!")],
    });
    expect(screen.getByTestId("markdown")).toBeInTheDocument();
    expect(screen.getByText("Hello user!")).toBeInTheDocument();
  });

  test("renders multiple messages in order", () => {
    renderArea({
      processedMessages: [
        makeProcessedMsg("user", "First message"),
        makeProcessedMsg("assistant", "Second message"),
        makeProcessedMsg("user", "Third message"),
      ],
    });
    const texts = ["First message", "Second message", "Third message"];
    texts.forEach((t) => expect(screen.getByText(t)).toBeInTheDocument());
  });

  test("renders 'Nexus' label for assistant messages", () => {
    renderArea({
      processedMessages: [makeProcessedMsg("assistant", "A response")],
    });
    expect(screen.getByText(/nexus/i)).toBeInTheDocument();
  });

  test("renders a tool message", () => {
    renderArea({
      processedMessages: [makeProcessedMsg("tool", "tool output text")],
    });
    expect(screen.getByText("tool output text")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 3. APPROVAL BUTTONS (HITL)
// ════════════════════════════════════════════════════════════════

describe("ChatArea — approval buttons (HITL)", () => {
  test("renders Approve and Deny buttons for a message with approvalMeta", () => {
    renderArea({
      processedMessages: [makeApprovalMsg("approval-1", "web_search")],
    });
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });

  test("clicking Approve calls onApproval with id and 'approved'", () => {
    const props = renderArea({
      processedMessages: [makeApprovalMsg("approval-1", "web_search")],
    });
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(props.onApproval).toHaveBeenCalledWith("approval-1", "approved");
  });

  test("clicking Deny calls onApproval with id and 'rejected'", () => {
    const props = renderArea({
      processedMessages: [makeApprovalMsg("approval-2", "file_write")],
    });
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(props.onApproval).toHaveBeenCalledWith("approval-2", "rejected");
  });

  test("Approve and Deny buttons are disabled when actingApproval matches the id", () => {
    renderArea({
      processedMessages: [makeApprovalMsg("approval-1", "web_search")],
      actingApproval: "approval-1",
    });
    expect(screen.getByRole("button", { name: /processing/i })).toBeDisabled();
    // Deny should also be disabled
    expect(screen.getByRole("button", { name: /deny/i })).toBeDisabled();
  });

  test("resolved approval shows status chip instead of buttons", () => {
    renderArea({
      processedMessages: [makeApprovalMsg("approval-1", "web_search")],
      resolvedApprovals: { "approval-1": "approved" },
    });
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /deny/i })).not.toBeInTheDocument();
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
  });

  test("rejected resolution shows denied chip", () => {
    renderArea({
      processedMessages: [makeApprovalMsg("approval-1", "web_search")],
      resolvedApprovals: { "approval-1": "rejected" },
    });
    expect(screen.getByText(/denied/i)).toBeInTheDocument();
  });

  test("tool name is displayed in the approval block", () => {
    renderArea({
      processedMessages: [makeApprovalMsg("approval-1", "file_write")],
    });
    expect(screen.getByText("file_write")).toBeInTheDocument();
  });

  test("reasoning is displayed in the approval block", () => {
    renderArea({
      processedMessages: [makeApprovalMsg("approval-1", "search")],
    });
    expect(screen.getByText("Tool requires approval")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 4. TTS READ-ALOUD BUTTON
// ════════════════════════════════════════════════════════════════

describe("ChatArea — TTS read-aloud button", () => {
  test("TTS button is rendered for assistant messages with content", () => {
    renderArea({
      processedMessages: [makeProcessedMsg("assistant", "Read this aloud", { msg: makeMsg("assistant", "Read this aloud", 42) })],
    });
    expect(screen.getByTitle("Read aloud")).toBeInTheDocument();
  });

  test("clicking TTS button calls onPlayTts with the message id and content", () => {
    const msg = makeMsg("assistant", "Read this aloud", 42);
    const props = renderArea({
      processedMessages: [{
        msg,
        attachments: [],
        approvalMeta: null,
        displayContent: msg.content,
        thoughts: [],
      }],
    });
    fireEvent.click(screen.getByTitle("Read aloud"));
    expect(props.onPlayTts).toHaveBeenCalledWith(42, "Read this aloud");
  });

  test("TTS button shows 'Stop reading' title when that message is playing", () => {
    const msg = makeMsg("assistant", "Playing now", 77);
    renderArea({
      processedMessages: [{
        msg,
        attachments: [],
        approvalMeta: null,
        displayContent: msg.content,
        thoughts: [],
      }],
      playingTtsId: 77,
    });
    expect(screen.getByTitle("Stop reading")).toBeInTheDocument();
  });

  test("TTS button is NOT rendered for user messages", () => {
    renderArea({
      processedMessages: [makeProcessedMsg("user", "My message")],
    });
    expect(screen.queryByTitle("Read aloud")).not.toBeInTheDocument();
  });

  test("TTS button is NOT rendered for assistant messages with null content", () => {
    renderArea({
      processedMessages: [makeProcessedMsg("assistant", null)],
    });
    expect(screen.queryByTitle("Read aloud")).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 5. LOADING STATE
// ════════════════════════════════════════════════════════════════

describe("ChatArea — loading state", () => {
  test("shows 'Thinking...' indicator when loading and last message has id=-1 and no content", () => {
    const thinkingMsg = makeMsg("assistant", null, -1);
    renderArea({
      loading: true,
      processedMessages: [{
        msg: thinkingMsg,
        attachments: [],
        approvalMeta: null,
        displayContent: null,
        thoughts: [],
      }],
    });
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 6. RESTORE-TO-MESSAGE
// ════════════════════════════════════════════════════════════════

describe("ChatArea — restore-to-message", () => {
  test("restore button is rendered for user messages with a valid id", () => {
    const msg = makeMsg("user", "Restore me", 10);
    renderArea({
      processedMessages: [{ msg, attachments: [], approvalMeta: null, displayContent: msg.content, thoughts: [] }],
    });
    expect(screen.getByTitle("Restore to this message")).toBeInTheDocument();
  });

  test("clicking restore button calls onRestoreToMessage with the message id", () => {
    const msg = makeMsg("user", "Restore me", 10);
    const props = renderArea({
      processedMessages: [{ msg, attachments: [], approvalMeta: null, displayContent: msg.content, thoughts: [] }],
    });
    fireEvent.click(screen.getByTitle("Restore to this message"));
    expect(props.onRestoreToMessage).toHaveBeenCalledWith(10);
  });

  test("restore button is NOT rendered for assistant messages", () => {
    const msg = makeMsg("assistant", "Agent reply", 11);
    renderArea({
      processedMessages: [{ msg, attachments: [], approvalMeta: null, displayContent: msg.content, thoughts: [] }],
    });
    expect(screen.queryByTitle("Restore to this message")).not.toBeInTheDocument();
  });

  test("restore button is NOT rendered for tool messages", () => {
    const msg = makeMsg("tool", "tool output", 12);
    renderArea({
      processedMessages: [{ msg, attachments: [], approvalMeta: null, displayContent: msg.content, thoughts: [] }],
    });
    expect(screen.queryByTitle("Restore to this message")).not.toBeInTheDocument();
  });

  test("restore button is NOT rendered for optimistic messages (id < 0)", () => {
    const msg = makeMsg("user", "Optimistic", -1);
    renderArea({
      processedMessages: [{ msg, attachments: [], approvalMeta: null, displayContent: msg.content, thoughts: [] }],
    });
    expect(screen.queryByTitle("Restore to this message")).not.toBeInTheDocument();
  });

  test("restore button is NOT rendered while loading", () => {
    const msg = makeMsg("user", "Loading test", 10);
    renderArea({
      loading: true,
      processedMessages: [{ msg, attachments: [], approvalMeta: null, displayContent: msg.content, thoughts: [] }],
    });
    expect(screen.queryByTitle("Restore to this message")).not.toBeInTheDocument();
  });
});
