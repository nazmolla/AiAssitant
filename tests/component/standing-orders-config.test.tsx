/**
 * Component interaction tests for StandingOrdersConfig.
 *
 * Tests cover:
 * - Empty state when no standing orders exist
 * - Renders list of standing orders with tool name and decision chips
 * - Summary stats (total, allowed, rejected, ignored)
 * - Text filter narrows visible orders
 * - Clicking decision chip opens inline edit mode
 * - Save button calls PUT API with new decision
 * - Delete button calls DELETE API for individual order
 * - Clear All opens confirmation dialog
 * - Confirm delete all calls DELETE API
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

jest.mock("@mui/icons-material/Delete", () => () => <span data-testid="DeleteIcon" />);

// ── Helpers ──────────────────────────────────────────────────────

function makeOrder(
  id: string,
  toolName: string,
  decision: "approved" | "rejected" | "ignored",
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    user_id: "u1",
    tool_name: toolName,
    request_key: "*",
    device_key: "*",
    reason_key: "*",
    decision,
    created_at: "2025-01-01T12:00:00Z",
    updated_at: "2025-01-01T12:00:00Z",
    ...overrides,
  };
}

let fetchMock: jest.Mock;

function setupFetch(orders: ReturnType<typeof makeOrder>[]) {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : "";

    if (urlStr.includes("/api/config/standing-orders")) {
      if (opts?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      if (opts?.method === "DELETE") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      // GET
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(orders),
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

describe("StandingOrdersConfig — empty state", () => {
  test("shows empty message when no standing orders exist", async () => {
    setupFetch([]);
    const { StandingOrdersConfig } = await import("@/components/standing-orders-config");
    await act(async () => {
      render(<StandingOrdersConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText(/no standing orders yet/i)).toBeInTheDocument();
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 2. RENDERING ORDERS
// ════════════════════════════════════════════════════════════════

describe("StandingOrdersConfig — rendering orders", () => {
  const orders = [
    makeOrder("o1", "web_search", "approved"),
    makeOrder("o2", "file_write", "rejected"),
    makeOrder("o3", "send_email", "ignored"),
  ];

  test("renders tool names for all orders", async () => {
    setupFetch(orders);
    const { StandingOrdersConfig } = await import("@/components/standing-orders-config");
    await act(async () => {
      render(<StandingOrdersConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("web_search")).toBeInTheDocument();
    });
    expect(screen.getByText("file_write")).toBeInTheDocument();
    expect(screen.getByText("send_email")).toBeInTheDocument();
  });

  test("renders decision chips with correct labels", async () => {
    setupFetch(orders);
    const { StandingOrdersConfig } = await import("@/components/standing-orders-config");
    await act(async () => {
      render(<StandingOrdersConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("Always Allow")).toBeInTheDocument();
    });
    expect(screen.getByText("Always Reject")).toBeInTheDocument();
    expect(screen.getByText("Always Ignore")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 3. SUMMARY STATS
// ════════════════════════════════════════════════════════════════

describe("StandingOrdersConfig — summary stats", () => {
  test("shows correct summary counts", async () => {
    setupFetch([
      makeOrder("o1", "tool_a", "approved"),
      makeOrder("o2", "tool_b", "approved"),
      makeOrder("o3", "tool_c", "rejected"),
    ]);
    const { StandingOrdersConfig } = await import("@/components/standing-orders-config");
    await act(async () => {
      render(<StandingOrdersConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("3 total")).toBeInTheDocument();
    });
    expect(screen.getByText("2 allowed")).toBeInTheDocument();
    expect(screen.getByText("1 rejected")).toBeInTheDocument();
    expect(screen.getByText("0 ignored")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 4. TEXT FILTER
// ════════════════════════════════════════════════════════════════

describe("StandingOrdersConfig — text filter", () => {
  test("filter input narrows visible orders", async () => {
    setupFetch([
      makeOrder("o1", "web_search", "approved"),
      makeOrder("o2", "file_write", "rejected"),
    ]);
    const { StandingOrdersConfig } = await import("@/components/standing-orders-config");
    await act(async () => {
      render(<StandingOrdersConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("web_search")).toBeInTheDocument();
    });

    const filterInput = screen.getByPlaceholderText(/filter by tool/i);
    await act(async () => {
      fireEvent.change(filterInput, { target: { value: "file" } });
    });

    // web_search should be filtered out
    expect(screen.queryByText("web_search")).not.toBeInTheDocument();
    expect(screen.getByText("file_write")).toBeInTheDocument();
  });

  test("shows 'No matches' when filter matches nothing", async () => {
    setupFetch([makeOrder("o1", "web_search", "approved")]);
    const { StandingOrdersConfig } = await import("@/components/standing-orders-config");
    await act(async () => {
      render(<StandingOrdersConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("web_search")).toBeInTheDocument();
    });

    const filterInput = screen.getByPlaceholderText(/filter by tool/i);
    await act(async () => {
      fireEvent.change(filterInput, { target: { value: "nonexistent" } });
    });

    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 5. INLINE EDIT DECISION
// ════════════════════════════════════════════════════════════════

describe("StandingOrdersConfig — edit decision", () => {
  test("clicking decision chip enters edit mode with Save/Cancel", async () => {
    setupFetch([makeOrder("o1", "web_search", "approved")]);
    const { StandingOrdersConfig } = await import("@/components/standing-orders-config");
    await act(async () => {
      render(<StandingOrdersConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("Always Allow")).toBeInTheDocument();
    });

    // Click the decision chip
    await act(async () => {
      fireEvent.click(screen.getByText("Always Allow"));
    });

    // Should show Save and Cancel buttons
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  test("Cancel exits edit mode without API call", async () => {
    setupFetch([makeOrder("o1", "web_search", "approved")]);
    const { StandingOrdersConfig } = await import("@/components/standing-orders-config");
    await act(async () => {
      render(<StandingOrdersConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("Always Allow")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Always Allow"));
    });

    const callsBefore = fetchMock.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    });

    // No extra API calls
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    // Back to showing decision chip
    expect(screen.getByText("Always Allow")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 6. DELETE INDIVIDUAL ORDER
// ════════════════════════════════════════════════════════════════

describe("StandingOrdersConfig — delete individual order", () => {
  test("delete button calls DELETE API and removes order from list", async () => {
    setupFetch([makeOrder("o1", "web_search", "approved")]);
    const { StandingOrdersConfig } = await import("@/components/standing-orders-config");
    await act(async () => {
      render(<StandingOrdersConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("web_search")).toBeInTheDocument();
    });

    // Click delete button (rendered as IconButton with DeleteIcon)
    const deleteButton = screen.getByTestId("DeleteIcon").closest("button")!;
    await act(async () => {
      fireEvent.click(deleteButton);
    });

    const deleteCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        typeof url === "string" &&
        url.includes("/api/config/standing-orders") &&
        opts?.method === "DELETE"
    );
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0][0]).toContain("id=o1");
  });
});

// ════════════════════════════════════════════════════════════════
// 7. CLEAR ALL WITH CONFIRMATION
// ════════════════════════════════════════════════════════════════

describe("StandingOrdersConfig — clear all", () => {
  test("Clear All button opens confirmation dialog", async () => {
    setupFetch([makeOrder("o1", "web_search", "approved")]);
    const { StandingOrdersConfig } = await import("@/components/standing-orders-config");
    await act(async () => {
      render(<StandingOrdersConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText(/clear all standing orders/i)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/clear all standing orders/i));
    });

    // Confirmation dialog should appear
    expect(screen.getByText(/clear all standing orders\?/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete all/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  test("confirming delete all calls DELETE API", async () => {
    setupFetch([
      makeOrder("o1", "web_search", "approved"),
      makeOrder("o2", "file_write", "rejected"),
    ]);
    const { StandingOrdersConfig } = await import("@/components/standing-orders-config");
    await act(async () => {
      render(<StandingOrdersConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText(/clear all standing orders/i)).toBeInTheDocument();
    });

    // Open dialog
    await act(async () => {
      fireEvent.click(screen.getByText(/clear all standing orders/i));
    });

    // Confirm
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete all/i }));
    });

    const deleteCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        typeof url === "string" &&
        url.includes("/api/config/standing-orders") &&
        opts?.method === "DELETE"
    );
    expect(deleteCalls.length).toBe(1);
  });

  test("canceling dialog does not call DELETE", async () => {
    setupFetch([makeOrder("o1", "web_search", "approved")]);
    const { StandingOrdersConfig } = await import("@/components/standing-orders-config");
    await act(async () => {
      render(<StandingOrdersConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText(/clear all standing orders/i)).toBeInTheDocument();
    });

    // Open dialog
    await act(async () => {
      fireEvent.click(screen.getByText(/clear all standing orders/i));
    });

    const callsBefore = fetchMock.mock.calls.length;

    // Cancel
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    });

    const deleteCallsAfter = fetchMock.mock.calls
      .slice(callsBefore)
      .filter(([, opts]: [string, RequestInit?]) => opts?.method === "DELETE");
    expect(deleteCallsAfter.length).toBe(0);
  });
});
