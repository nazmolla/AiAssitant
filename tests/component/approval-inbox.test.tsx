/**
 * Component interaction tests for ApprovalInbox.
 *
 * Tests cover:
 * - Empty state when no pending approvals
 * - Single approval rendering with Approve/Deny buttons
 * - Approve button calls API with correct action
 * - Deny button calls API with correct action
 * - Grouped approvals (same tool_name) render with expand/collapse
 * - Bulk Approve All / Deny All for grouped items
 * - Global Approve All / Deny All when multiple approvals exist
 * - Buttons disabled while action is processing
 * - Dispatches approval-resolved event on successful approve
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: { user: { email: "user@test.com", id: "u1" }, expires: "2099-01-01" },
    status: "authenticated",
  })),
}));

jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    formatDate: (s: string) => s,
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────

function makeApproval(
  id: string,
  toolName: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    thread_id: "thread-1",
    tool_name: toolName,
    args: JSON.stringify({ input: "test" }),
    reasoning: "Agent needs approval",
    status: "pending",
    created_at: "2025-01-01T12:00:00Z",
    ...overrides,
  };
}

let fetchMock: jest.Mock;

function setupFetch(approvals: ReturnType<typeof makeApproval>[]) {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("/api/approvals")) {
      if (opts?.method === "POST") {
        const body = JSON.parse(opts.body as string);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ approvalId: body.approvalId, action: body.action }),
        });
      }
      // GET
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(approvals),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════
// 1. EMPTY STATE
// ════════════════════════════════════════════════════════════════

describe("ApprovalInbox — empty state", () => {
  test("shows 'No pending approvals' when list is empty", async () => {
    setupFetch([]);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByText(/no pending approvals/i)).toBeInTheDocument();
    });
  });

  test("shows '0 pending' chip when list is empty", async () => {
    setupFetch([]);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByText("0 pending")).toBeInTheDocument();
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 2. SINGLE APPROVAL RENDERING
// ════════════════════════════════════════════════════════════════

describe("ApprovalInbox — single approval", () => {
  test("renders tool name, reasoning, and action buttons", async () => {
    setupFetch([makeApproval("a1", "web_search")]);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByText("web_search")).toBeInTheDocument();
    });
    expect(screen.getByText("Agent needs approval")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });

  test("shows '1 pending' chip", async () => {
    setupFetch([makeApproval("a1", "file_write")]);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByText("1 pending")).toBeInTheDocument();
    });
  });

  test("shows Proactive chip when thread_id is null", async () => {
    setupFetch([makeApproval("a1", "web_search", { thread_id: null })]);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByText("Proactive")).toBeInTheDocument();
    });
  });

  test("renders parsed arguments as JSON", async () => {
    setupFetch([
      makeApproval("a1", "web_search", {
        args: JSON.stringify({ query: "test query", limit: 5 }),
      }),
    ]);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByText(/"query": "test query"/)).toBeInTheDocument();
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 3. APPROVE / DENY ACTIONS
// ════════════════════════════════════════════════════════════════

describe("ApprovalInbox — approve/deny actions", () => {
  test("clicking Approve calls POST /api/approvals with 'approved'", async () => {
    setupFetch([makeApproval("a1", "web_search")]);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        url.includes("/api/approvals") && opts?.method === "POST"
    );
    expect(postCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(postCalls[0][1].body as string);
    expect(body).toEqual({ approvalId: "a1", action: "approved" });
  });

  test("clicking Deny calls POST /api/approvals with 'rejected'", async () => {
    setupFetch([makeApproval("a1", "file_write")]);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        url.includes("/api/approvals") && opts?.method === "POST"
    );
    expect(postCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(postCalls[0][1].body as string);
    expect(body).toEqual({ approvalId: "a1", action: "rejected" });
  });

  test("dispatches approval-resolved custom event on successful approve", async () => {
    setupFetch([makeApproval("a1", "web_search")]);
    const { ApprovalInbox } = await import("@/components/approval-inbox");

    const eventHandler = jest.fn();
    window.addEventListener("approval-resolved", eventHandler);

    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    });

    await waitFor(() => {
      expect(eventHandler).toHaveBeenCalled();
    });

    window.removeEventListener("approval-resolved", eventHandler);
  });

  test("does NOT dispatch approval-resolved on deny", async () => {
    setupFetch([makeApproval("a1", "web_search")]);
    const { ApprovalInbox } = await import("@/components/approval-inbox");

    const eventHandler = jest.fn();
    window.addEventListener("approval-resolved", eventHandler);

    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    });

    // Give it a tick to process
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(eventHandler).not.toHaveBeenCalled();
    window.removeEventListener("approval-resolved", eventHandler);
  });
});

// ════════════════════════════════════════════════════════════════
// 4. GROUPED APPROVALS
// ════════════════════════════════════════════════════════════════

describe("ApprovalInbox — grouped approvals", () => {
  const groupedApprovals = [
    makeApproval("a1", "web_search"),
    makeApproval("a2", "web_search"),
    makeApproval("a3", "web_search"),
  ];

  test("groups multiple approvals by tool_name with pending count", async () => {
    setupFetch(groupedApprovals);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      const chips = screen.getAllByText("3 pending");
      expect(chips.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText("web_search")).toBeInTheDocument();
  });

  test("expand/collapse on group card click reveals individual items", async () => {
    setupFetch(groupedApprovals);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByText("web_search")).toBeInTheDocument();
    });

    // Initially collapsed — individual Approve buttons not shown
    const initialApproveButtons = screen.queryAllByRole("button", { name: /^approve$/i });
    // The group shows "Approve All 3" not individual "Approve"
    expect(initialApproveButtons.length).toBe(0);

    // Click to expand
    await act(async () => {
      fireEvent.click(screen.getByText("web_search"));
    });

    // After expanding, individual Approve/Deny buttons appear
    await waitFor(() => {
      const expandedApproveButtons = screen.getAllByRole("button", { name: /^approve$/i });
      expect(expandedApproveButtons.length).toBe(3);
    });
  });

  test("group-level Approve All calls bulk API for all group items", async () => {
    setupFetch(groupedApprovals);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve all 3/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /approve all 3/i }));
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        url.includes("/api/approvals") && opts?.method === "POST"
    );
    expect(postCalls.length).toBe(3);
    const ids = postCalls.map(([, opts]: [string, RequestInit]) => JSON.parse(opts.body as string).approvalId);
    expect(ids).toEqual(expect.arrayContaining(["a1", "a2", "a3"]));
  });

  test("group-level Deny All calls bulk API with 'rejected'", async () => {
    setupFetch(groupedApprovals);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /deny all 3/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /deny all 3/i }));
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        url.includes("/api/approvals") && opts?.method === "POST"
    );
    expect(postCalls.length).toBe(3);
    postCalls.forEach(([, opts]: [string, RequestInit]) => {
      expect(JSON.parse(opts.body as string).action).toBe("rejected");
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 5. GLOBAL BULK ACTIONS
// ════════════════════════════════════════════════════════════════

describe("ApprovalInbox — global bulk actions", () => {
  const mixedApprovals = [
    makeApproval("a1", "web_search"),
    makeApproval("a2", "file_write"),
  ];

  test("shows global Approve All / Deny All when multiple approvals exist", async () => {
    setupFetch(mixedApprovals);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve all \(2\)/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /deny all \(2\)/i })).toBeInTheDocument();
  });

  test("global Approve All does NOT appear for single approval", async () => {
    setupFetch([makeApproval("a1", "web_search")]);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByText("web_search")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /approve all \(/i })).not.toBeInTheDocument();
  });

  test("global Approve All sends POST for every approval", async () => {
    setupFetch(mixedApprovals);
    const { ApprovalInbox } = await import("@/components/approval-inbox");
    await act(async () => {
      render(<ApprovalInbox />);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve all \(2\)/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /approve all \(2\)/i }));
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        url.includes("/api/approvals") && opts?.method === "POST"
    );
    expect(postCalls.length).toBe(2);
  });
});
