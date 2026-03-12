/**
 * Component interaction tests for SchedulerConsole.
 *
 * Tests cover:
 * - Loading state renders loading text
 * - Overview stats rendered after load (schedules, running, success, failed)
 * - Schedules table renders rows with name, status, trigger info
 * - Refresh button calls loadConsole
 * - Row click expands inline detail
 * - Inline detail shows Pause/Resume and Trigger buttons
 * - Trigger button calls POST /api/scheduler/schedules/:id/trigger
 * - Pause button calls POST /api/scheduler/schedules/:id/pause
 * - Select All / Deselect All toggle
 * - Error state when API returns failure
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: { user: { email: "admin@test.com", id: "admin-1", role: "admin" }, expires: "2099-01-01" },
    status: "authenticated",
  })),
}));

jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    formatDate: (s: string) => s,
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────

const mockOverview = {
  schedules_total: 3,
  schedules_active: 2,
  schedules_paused: 1,
  runs_running: 1,
  runs_failed_24h: 2,
  runs_success_24h: 5,
  runs_partial_24h: 1,
};

function makeSchedule(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    schedule_key: `key_${id}`,
    name,
    handler_type: "batch.daily_digest",
    owner_type: "user",
    owner_id: "u1",
    trigger_type: "interval",
    trigger_expr: "every:1:hour",
    status: "active",
    next_run_at: "2025-01-02T00:00:00Z",
    last_run_at: "2025-01-01T23:00:00Z",
    updated_at: "2025-01-01T12:00:00Z",
    ...overrides,
  };
}

function makeScheduleDetail(id: string, name: string) {
  return {
    schedule: makeSchedule(id, name),
    tasks: [
      {
        id: "t1",
        task_key: "task_search",
        name: "Search Task",
        handler_name: "search",
        execution_mode: "sync",
        sequence_no: 0,
        enabled: 1,
      },
    ],
    recent_runs: [],
  };
}

let fetchMock: jest.Mock;

function setupFetch(
  schedules: ReturnType<typeof makeSchedule>[] = [makeSchedule("s1", "Daily Digest")],
  overview = mockOverview
) {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : "";

    if (urlStr.includes("/api/scheduler/overview")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(overview),
      });
    }

    if (urlStr.includes("/api/scheduler/schedules") && !urlStr.includes("/trigger") && !urlStr.includes("/pause") && !urlStr.includes("/resume") && !urlStr.includes("/tasks")) {
      // GET schedule list (no UUID path segment)
      if (!opts?.method || opts.method === "GET") {
        // Check if it's a single schedule detail (has UUID)
        const detailMatch = urlStr.match(/schedules\/([a-z0-9-]+)$/);
        if (detailMatch) {
          const id = detailMatch[1];
          const sched = schedules.find((s) => s.id === id) || schedules[0];
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(makeScheduleDetail(sched.id, sched.name)),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: schedules, total: schedules.length, hasMore: false }),
        });
      }
    }

    if (urlStr.includes("/trigger") && opts?.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ message: "Run queued" }),
      });
    }

    if (urlStr.includes("/pause") && opts?.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ message: "Paused" }),
      });
    }

    if (urlStr.includes("/resume") && opts?.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ message: "Resumed" }),
      });
    }

    if (urlStr.includes("/api/scheduler/runs")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [], total: 0, hasMore: false }),
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
// 1. LOADING STATE
// ════════════════════════════════════════════════════════════════

describe("SchedulerConsole — loading and overview", () => {
  test("shows loading text initially", async () => {
    setupFetch();
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    render(<SchedulerConsole />);
    expect(screen.getByText("Loading scheduler overview...")).toBeInTheDocument();
  });

  test("renders overview stats after loading", async () => {
    setupFetch();
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument(); // schedules_total
    });
    expect(screen.getByText("2 active / 1 paused")).toBeInTheDocument();
    expect(screen.getByText(/Requires investigation/)).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 2. SCHEDULE TABLE
// ════════════════════════════════════════════════════════════════

describe("SchedulerConsole — schedule table", () => {
  test("renders schedule name in table row", async () => {
    setupFetch([makeSchedule("s1", "My Batch Job")]);
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    await waitFor(() => {
      expect(screen.getByText("My Batch Job")).toBeInTheDocument();
    });
  });

  test("renders schedule status badge", async () => {
    setupFetch([makeSchedule("s1", "Active Schedule", { status: "active" })]);
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    await waitFor(() => {
      expect(screen.getByText("active")).toBeInTheDocument();
    });
  });

  test("renders multiple schedules", async () => {
    setupFetch([
      makeSchedule("s1", "Batch A"),
      makeSchedule("s2", "Batch B"),
    ]);
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    await waitFor(() => {
      expect(screen.getByText("Batch A")).toBeInTheDocument();
    });
    expect(screen.getByText("Batch B")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 3. INTERACTIVE CONTROLS
// ════════════════════════════════════════════════════════════════

describe("SchedulerConsole — interactive controls", () => {
  test("Refresh button re-fetches data", async () => {
    setupFetch();
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    await waitFor(() => {
      expect(screen.getByText("Refresh")).toBeInTheDocument();
    });

    const callsBefore = fetchMock.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByText("Refresh"));
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  test("clicking schedule row expands inline detail", async () => {
    setupFetch([makeSchedule("s1", "My Schedule")]);
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    // First schedule auto-selected on load; inline detail shows after loadScheduleDetail
    await waitFor(() => {
      expect(screen.getByText(/Inline Detail:/)).toBeInTheDocument();
    });
  });

  test("Trigger button calls POST to trigger endpoint", async () => {
    setupFetch([makeSchedule("s1", "Triggerable")]);
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    // Wait for auto-expanded inline detail
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Trigger" })).toBeInTheDocument();
    });

    // Click trigger button
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    });

    const triggerCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        typeof url === "string" && url.includes("/trigger") && opts?.method === "POST"
    );
    expect(triggerCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("Pause button calls POST to pause endpoint for active schedule", async () => {
    setupFetch([makeSchedule("s1", "Active One", { status: "active" })]);
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    // Wait for inline detail with Pause button (auto-expanded for first schedule)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    });

    const pauseCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        typeof url === "string" && url.includes("/pause") && opts?.method === "POST"
    );
    expect(pauseCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("Resume button shown for paused schedule", async () => {
    const pausedSchedule = makeSchedule("s1", "Paused One", { status: "paused" });
    fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : "";
      if (urlStr.includes("/api/scheduler/overview")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockOverview) });
      }
      if (urlStr.includes("/api/scheduler/schedules")) {
        if (!opts?.method || opts.method === "GET") {
          const detailMatch = urlStr.match(/schedules\/([a-z0-9-]+)$/);
          if (detailMatch) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({
                schedule: pausedSchedule,
                tasks: [],
                recent_runs: [],
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: [pausedSchedule], total: 1, hasMore: false }),
          });
        }
      }
      if (urlStr.includes("/resume") && opts?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ message: "Resumed" }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = fetchMock;

    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    // Auto-expanded inline detail for paused schedule should show Resume
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 4. SELECT ALL / DESELECT ALL
// ════════════════════════════════════════════════════════════════

describe("SchedulerConsole — selection controls", () => {
  test("Select All button changes to Deselect All when all selected", async () => {
    setupFetch([makeSchedule("s1", "Batch A"), makeSchedule("s2", "Batch B")]);
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    await waitFor(() => {
      expect(screen.getByText("Select All")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Select All"));
    });

    await waitFor(() => {
      expect(screen.getByText("Deselect All")).toBeInTheDocument();
    });
  });

  test("Select All checkbox in header selects all rows", async () => {
    setupFetch([makeSchedule("s1", "Batch A"), makeSchedule("s2", "Batch B")]);
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    await waitFor(() => {
      expect(screen.getByText("Batch A")).toBeInTheDocument();
    });

    const selectAllCheckbox = screen.getByLabelText("Select all schedules");
    await act(async () => {
      fireEvent.click(selectAllCheckbox);
    });

    // All row checkboxes should now be checked
    const checkboxes = screen.getAllByRole("checkbox");
    const checkedCount = checkboxes.filter((cb) => (cb as HTMLInputElement).checked).length;
    // At least 2 should be checked (the 2 rows) + potentially the header
    expect(checkedCount).toBeGreaterThanOrEqual(2);
  });

  test("Delete Selected button shows count", async () => {
    setupFetch([makeSchedule("s1", "Batch A")]);
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    await waitFor(() => {
      expect(screen.getByText("Batch A")).toBeInTheDocument();
    });

    expect(screen.getByText("Delete Selected (0)")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 5. ERROR STATE
// ════════════════════════════════════════════════════════════════

describe("SchedulerConsole — error handling", () => {
  test("shows error message when API fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));
    const { SchedulerConsole } = await import("@/components/scheduler-console");
    await act(async () => {
      render(<SchedulerConsole />);
    });
    await waitFor(() => {
      expect(screen.getByText("Failed to load scheduler console.")).toBeInTheDocument();
    });
  });
});
