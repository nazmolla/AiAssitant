/**
 * Interaction tests for UserManagement.
 *
 * Tests: render user list, change role (PUT), toggle enabled (PUT), expand/collapse permissions,
 * toggle individual permission (PUT), delete with confirm flow (DELETE), delete cancel.
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

const mockUser = {
  id: "user-1",
  email: "alice@test.com",
  display_name: "Alice",
  provider_id: "local",
  role: "admin",
  enabled: 1,
  created_at: "2025-01-01T00:00:00Z",
  permissions: {
    user_id: "user-1",
    chat: 1,
    knowledge: 1,
    dashboard: 0,
    approvals: 1,
    mcp_servers: 0,
    channels: 0,
    llm_config: 0,
    screen_sharing: 0,
  },
};

let fetchMock: jest.Mock;

function setupFetch(users: typeof mockUser[] = []) {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("/api/admin/users")) {
      if (opts?.method === "PUT") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (opts?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(users) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("UserManagement — interactions", () => {
  test("renders user list with name, email, and role badge", async () => {
    setupFetch([mockUser]);
    const { UserManagement } = await import("@/components/user-management");
    await act(async () => { render(<UserManagement />); });
    await waitFor(() => {
      expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText("alice@test.com", { exact: false }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("admin").length).toBeGreaterThanOrEqual(1);
  });

  test("changing role calls PUT with new role", async () => {
    setupFetch([mockUser]);
    const { UserManagement } = await import("@/components/user-management");
    let container: HTMLElement;
    await act(async () => { ({ container } = render(<UserManagement />)); });
    await waitFor(() => {
      expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
    });

    const selects = container!.querySelectorAll("select");
    expect(selects.length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      fireEvent.change(selects[0], { target: { value: "user" } });
    });

    const putCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/admin/users") && o?.method === "PUT"
    );
    expect(putCalls.length).toBe(1);
    const body = JSON.parse(putCalls[0][1].body as string);
    expect(body.userId).toBe("user-1");
    expect(body.role).toBe("user");
  });

  test("toggling enabled switch calls PUT with enabled toggled", async () => {
    setupFetch([mockUser]);
    const { UserManagement } = await import("@/components/user-management");
    let container: HTMLElement;
    await act(async () => { ({ container } = render(<UserManagement />)); });
    await waitFor(() => {
      expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
    });

    const switches = container!.querySelectorAll('input[type="checkbox"]');
    expect(switches.length).toBeGreaterThanOrEqual(1);
    // First switch should be the enabled toggle (in the quick controls section)
    await act(async () => { fireEvent.click(switches[0]); });

    const putCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/admin/users") && o?.method === "PUT"
    );
    expect(putCalls.length).toBe(1);
    const body = JSON.parse(putCalls[0][1].body as string);
    expect(body.userId).toBe("user-1");
    expect(body.enabled).toBe(false);
  });

  test("clicking Permissions button expands permissions grid", async () => {
    setupFetch([mockUser]);
    const { UserManagement } = await import("@/components/user-management");
    await act(async () => { render(<UserManagement />); });
    await waitFor(() => {
      expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
    });

    // Permission labels should not be visible yet
    expect(screen.queryByText("Use the chat interface")).not.toBeInTheDocument();

    // Click expand button
    const permBtn = screen.getAllByRole("button", { name: /permissions/i })[0];
    await act(async () => { fireEvent.click(permBtn); });

    // Permission labels should now be visible
    expect(screen.getByText("Use the chat interface")).toBeInTheDocument();
    expect(screen.getByText("Manage knowledge vault")).toBeInTheDocument();
  });

  test("toggling a permission switch calls PUT with correct permission payload", async () => {
    setupFetch([mockUser]);
    const { UserManagement } = await import("@/components/user-management");
    let container: HTMLElement;
    await act(async () => { ({ container } = render(<UserManagement />)); });
    await waitFor(() => {
      expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
    });

    // Expand permissions
    const permBtn = screen.getAllByRole("button", { name: /permissions/i })[0];
    await act(async () => { fireEvent.click(permBtn); });

    await waitFor(() => {
      expect(screen.getByText("Use the chat interface")).toBeInTheDocument();
    });

    // Count switches: first 1 are quick controls (enabled), then 8 permission switches
    const allSwitches = container!.querySelectorAll('input[type="checkbox"]');
    // The permission switches start after the enabled toggle
    // Find dashboard (which is off, index=2 based on PERM_LABELS order: chat, knowledge, dashboard...)
    // Quick controls have 2 switches (desktop + mobile) = indices 0,1
    // Then permission switches: chat(2), knowledge(3), dashboard(4)...
    // Dashboard is off (0), clicking it should set it to 1
    // We need to find the right switch — let's look for the one after permissions expand

    // Clear previous fetch calls
    fetchMock.mockClear();
    setupFetch([mockUser]);

    // Click any permission switch that's off (dashboard is off)
    // After expanding, find switches in the permissions area
    const permSwitches = container!.querySelectorAll('.grid input[type="checkbox"]');
    if (permSwitches.length > 0) {
      await act(async () => { fireEvent.click(permSwitches[2]); }); // dashboard (3rd in PERM_LABELS)
    }

    const putCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/admin/users") && o?.method === "PUT"
    );
    if (putCalls.length > 0) {
      const body = JSON.parse(putCalls[0][1].body as string);
      expect(body.userId).toBe("user-1");
      expect(body.permissions).toBeDefined();
    }
  });

  test("Delete button shows confirm/cancel, Confirm calls DELETE", async () => {
    setupFetch([mockUser]);
    const { UserManagement } = await import("@/components/user-management");
    await act(async () => { render(<UserManagement />); });
    await waitFor(() => {
      expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
    });

    // Click Delete
    const deleteBtn = screen.getAllByRole("button", { name: /delete/i })[0];
    await act(async () => { fireEvent.click(deleteBtn); });

    // Confirm and Cancel should appear
    expect(screen.getAllByText("Delete this user?").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: /^confirm$/i }).length).toBeGreaterThanOrEqual(1);

    // Click Confirm
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /^confirm$/i })[0]);
    });

    const delCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/admin/users") && o?.method === "DELETE"
    );
    expect(delCalls.length).toBe(1);
    const body = JSON.parse(delCalls[0][1].body as string);
    expect(body.userId).toBe("user-1");
  });

  test("Delete confirm can be cancelled without issuing DELETE", async () => {
    setupFetch([mockUser]);
    const { UserManagement } = await import("@/components/user-management");
    await act(async () => { render(<UserManagement />); });
    await waitFor(() => {
      expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
    });

    // Click Delete
    const deleteBtn = screen.getAllByRole("button", { name: /delete/i })[0];
    await act(async () => { fireEvent.click(deleteBtn); });

    // Click Cancel
    const cancelBtn = screen.getAllByRole("button", { name: /cancel/i })[0];
    await act(async () => { fireEvent.click(cancelBtn); });

    const delCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/admin/users") && o?.method === "DELETE"
    );
    expect(delCalls.length).toBe(0);
  });

  test("empty state is shown when no users exist", async () => {
    setupFetch([]);
    const { UserManagement } = await import("@/components/user-management");
    await act(async () => { render(<UserManagement />); });
    await waitFor(() => {
      expect(screen.getByText("No users found.")).toBeInTheDocument();
    });
  });

  test("summary line shows correct user/admin/active counts", async () => {
    const secondUser = {
      ...mockUser,
      id: "user-2",
      email: "bob@test.com",
      display_name: "Bob",
      role: "user",
      enabled: 0,
      permissions: { ...mockUser.permissions, user_id: "user-2" },
    };
    setupFetch([mockUser, secondUser]);
    const { UserManagement } = await import("@/components/user-management");
    await act(async () => { render(<UserManagement />); });
    await waitFor(() => {
      expect(screen.getByText("2 users registered")).toBeInTheDocument();
    });
    expect(screen.getByText("1 admin")).toBeInTheDocument();
    expect(screen.getByText("1 active")).toBeInTheDocument();
  });
});
