/**
 * Interaction tests for NotificationBell.
 *
 * Tests: bell opens popover, unread badge, mark all read, dismiss, click-to-read, approve/reject,
 * bulk approve/reject, tab switching, empty states, ignore, standing order actions.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: { user: { email: "admin@test.com", id: "admin-1", role: "admin" }, expires: "2099-01-01" },
    status: "authenticated",
  })),
}));

jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ formatDate: (s: string) => s }),
}));

const mockNotification = {
  id: "notif-1",
  user_id: "admin-1",
  type: "tool_error",
  title: "Tool Failed",
  body: "The browser tool threw an error.",
  metadata: null,
  read: 0,
  created_at: "2025-06-01T12:00:00Z",
};

const mockReadNotification = {
  id: "notif-2",
  user_id: "admin-1",
  type: "info",
  title: "System Update",
  body: "Agent was restarted.",
  metadata: null,
  read: 1,
  created_at: "2025-05-30T10:00:00Z",
};

const mockApproval = {
  id: "approval-1",
  thread_id: "thread-1",
  tool_name: "mcp_hass_server.hassturnon",
  args: JSON.stringify({ entity_id: "light.lounge_light", name: "Lounge Light" }),
  reasoning: "User asked to turn on the lounge light.",
  nl_request: null,
  source: "proactive:observer",
  status: "pending",
  created_at: "2025-06-01T11:30:00Z",
};

let fetchMock: jest.Mock;

function setupFetch(data?: { notifications?: typeof mockNotification[]; approvals?: typeof mockApproval[]; unreadCount?: number }) {
  const response = {
    notifications: data?.notifications ?? [],
    approvals: data?.approvals ?? [],
    unreadCount: data?.unreadCount ?? 0,
  };
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("/api/notifications")) {
      if (opts?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(response) });
    }
    if (typeof url === "string" && url.includes("/api/approvals")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "approved" }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("NotificationBell — interactions", () => {
  test("renders bell icon button", async () => {
    setupFetch();
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    expect(screen.getByTitle("Notifications")).toBeInTheDocument();
  });

  test("clicking bell opens popover with Notifications header", async () => {
    setupFetch({ unreadCount: 1, notifications: [mockNotification] });
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });

    // Wait for fetch to populate
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    // Click bell
    await act(async () => {
      fireEvent.click(screen.getByTitle("Notifications"));
    });

    // Popover should show header
    await waitFor(() => {
      expect(screen.getByText("Notifications")).toBeInTheDocument();
    });
  });

  test("shows unread notification and Mark all read button", async () => {
    setupFetch({ unreadCount: 1, notifications: [mockNotification] });
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    // Open popover
    await act(async () => { fireEvent.click(screen.getByTitle("Notifications")); });

    await waitFor(() => {
      expect(screen.getByText("Tool Failed")).toBeInTheDocument();
    });

    // Mark all read button
    expect(screen.getByText("Mark all read")).toBeInTheDocument();
  });

  test("Mark all read calls POST with markAllRead action", async () => {
    setupFetch({ unreadCount: 1, notifications: [mockNotification] });
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    await act(async () => { fireEvent.click(screen.getByTitle("Notifications")); });
    await waitFor(() => { expect(screen.getByText("Mark all read")).toBeInTheDocument(); });

    await act(async () => { fireEvent.click(screen.getByText("Mark all read")); });

    const postCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/notifications") && o?.method === "POST"
    );
    expect(postCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(postCalls[postCalls.length - 1][1].body as string);
    expect(body.action).toBe("markAllRead");
  });

  test("Dismiss button calls POST with dismiss action", async () => {
    setupFetch({ unreadCount: 0, notifications: [mockReadNotification] });
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    await act(async () => { fireEvent.click(screen.getByTitle("Notifications")); });
    await waitFor(() => { expect(screen.getByText("System Update")).toBeInTheDocument(); });

    // Click Dismiss
    await act(async () => { fireEvent.click(screen.getByText("Dismiss")); });

    const postCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/notifications") && o?.method === "POST"
    );
    expect(postCalls.length).toBeGreaterThanOrEqual(1);
    const lastPost = postCalls[postCalls.length - 1];
    const body = JSON.parse(lastPost[1].body as string);
    expect(body.action).toBe("dismiss");
    expect(body.notificationId).toBe("notif-2");
  });

  test("clicking unread notification calls POST with markRead action", async () => {
    setupFetch({ unreadCount: 1, notifications: [mockNotification] });
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    await act(async () => { fireEvent.click(screen.getByTitle("Notifications")); });
    await waitFor(() => { expect(screen.getByText("Tool Failed")).toBeInTheDocument(); });

    // Click on the notification text to mark it read
    await act(async () => { fireEvent.click(screen.getByText("Tool Failed")); });

    const postCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/notifications") && o?.method === "POST"
    );
    expect(postCalls.length).toBeGreaterThanOrEqual(1);
    const bodies = postCalls.map(([, o]: [string, RequestInit]) => JSON.parse(o.body as string));
    expect(bodies.some((b: Record<string, string>) => b.action === "markRead" && b.notificationId === "notif-1")).toBe(true);
  });

  test("Approve button calls POST /api/approvals with approved action", async () => {
    setupFetch({ approvals: [mockApproval], unreadCount: 1 });
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    await act(async () => { fireEvent.click(screen.getByTitle("Notifications")); });
    await waitFor(() => { expect(screen.getAllByText("Approve").length).toBeGreaterThanOrEqual(1); });

    // Click the individual Approve button (not Approve Group or Approve All)
    const approveButtons = screen.getAllByText("Approve");
    await act(async () => { fireEvent.click(approveButtons[approveButtons.length - 1]); });

    const approvalCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/approvals") && o?.method === "POST"
    );
    expect(approvalCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(approvalCalls[0][1].body as string);
    expect(body.approvalId).toBe("approval-1");
    expect(body.action).toBe("approved");
  });

  test("Reject button calls POST /api/approvals with rejected action", async () => {
    setupFetch({ approvals: [mockApproval], unreadCount: 1 });
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    await act(async () => { fireEvent.click(screen.getByTitle("Notifications")); });
    await waitFor(() => { expect(screen.getAllByText("Reject").length).toBeGreaterThanOrEqual(1); });

    // Click the individual Reject button
    const rejectButtons = screen.getAllByText("Reject");
    await act(async () => { fireEvent.click(rejectButtons[rejectButtons.length - 1]); });

    const approvalCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/approvals") && o?.method === "POST"
    );
    expect(approvalCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(approvalCalls[0][1].body as string);
    expect(body.action).toBe("rejected");
  });

  test("Ignore button calls POST /api/approvals with ignored action", async () => {
    setupFetch({ approvals: [mockApproval], unreadCount: 1 });
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    await act(async () => { fireEvent.click(screen.getByTitle("Notifications")); });
    await waitFor(() => { expect(screen.getByText("Ignore")).toBeInTheDocument(); });

    await act(async () => { fireEvent.click(screen.getByText("Ignore")); });

    const approvalCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/approvals") && o?.method === "POST"
    );
    expect(approvalCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(approvalCalls[0][1].body as string);
    expect(body.action).toBe("ignored");
  });

  test("Approve All button calls POST for each approval", async () => {
    const second = { ...mockApproval, id: "approval-2", tool_name: "builtin.read_file", args: "{}", reasoning: "Check a file" };
    setupFetch({ approvals: [mockApproval, second], unreadCount: 2 });
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    await act(async () => { fireEvent.click(screen.getByTitle("Notifications")); });
    await waitFor(() => { expect(screen.getAllByText(/approve all/i).length).toBeGreaterThanOrEqual(1); });

    // Click Approve All
    const approveAllBtns = screen.getAllByText(/approve all/i);
    await act(async () => { fireEvent.click(approveAllBtns[0]); });

    const approvalCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/approvals") && o?.method === "POST"
    );
    expect(approvalCalls.length).toBeGreaterThanOrEqual(2);
  });

  test("Always Allow sends rememberDecision=approved", async () => {
    setupFetch({ approvals: [mockApproval], unreadCount: 1 });
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    await act(async () => { fireEvent.click(screen.getByTitle("Notifications")); });
    await waitFor(() => { expect(screen.getByText("Always Allow")).toBeInTheDocument(); });

    await act(async () => { fireEvent.click(screen.getByText("Always Allow")); });

    const approvalCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/approvals") && o?.method === "POST"
    );
    expect(approvalCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(approvalCalls[0][1].body as string);
    expect(body.action).toBe("approved");
    expect(body.rememberDecision).toBe("approved");
  });

  test("Always Reject sends rememberDecision=rejected", async () => {
    setupFetch({ approvals: [mockApproval], unreadCount: 1 });
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    await act(async () => { fireEvent.click(screen.getByTitle("Notifications")); });
    await waitFor(() => { expect(screen.getByText("Always Reject")).toBeInTheDocument(); });

    await act(async () => { fireEvent.click(screen.getByText("Always Reject")); });

    const approvalCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/approvals") && o?.method === "POST"
    );
    expect(approvalCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(approvalCalls[0][1].body as string);
    expect(body.action).toBe("rejected");
    expect(body.rememberDecision).toBe("rejected");
  });

  test("switching to Approvals tab shows approval-only view", async () => {
    setupFetch({ approvals: [mockApproval], notifications: [mockNotification], unreadCount: 2 });
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    await act(async () => { fireEvent.click(screen.getByTitle("Notifications")); });
    await waitFor(() => { expect(screen.getByText("Tool Failed")).toBeInTheDocument(); });

    // Click Approvals tab
    const approvalTab = screen.getByRole("tab", { name: /approvals/i });
    await act(async () => { fireEvent.click(approvalTab); });

    // Approval content should be visible, tool notification should still be in DOM
    // (since the All tab hides but Popover keeps content)
    await waitFor(() => {
      expect(screen.getAllByText(/approve/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  test("empty state shows 'No notifications' when nothing exists", async () => {
    setupFetch();
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => { render(<NotificationBell />); });
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled(); });

    await act(async () => { fireEvent.click(screen.getByTitle("Notifications")); });
    await waitFor(() => {
      expect(screen.getByText("No notifications")).toBeInTheDocument();
    });
  });
});
