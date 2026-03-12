/**
 * Component interaction tests for DbManagementConfig.
 *
 * Tests cover:
 * - Loading state shows loading text
 * - Renders DB size breakdown and table rows
 * - Renders host resource snapshot
 * - Cleanup policy toggles update state
 * - Save Policy button calls PUT API
 * - Run Cleanup Now button calls POST API
 * - Refresh Snapshot button re-fetches data
 * - Retention input fields accept numeric values
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

const mockConfig = {
  enabled: true,
  intervalHours: 24,
  logsRetentionDays: 30,
  threadsRetentionDays: 90,
  attachmentsRetentionDays: 90,
  cleanupLogs: true,
  cleanupThreads: false,
  cleanupAttachments: true,
  cleanupOrphanFiles: false,
  lastRunAt: "2025-01-01T00:00:00Z",
};

const mockStorage = {
  dbPath: "/data/nexus.db",
  dbBytes: 850000000,
  walBytes: 1000000,
  shmBytes: 32768,
  attachmentsBytes: 200000000,
  totalManagedBytes: 1051032768,
  pageCount: 200000,
  pageSize: 4096,
  tables: [
    { table: "messages", rowCount: 50000, estimatedBytes: 400000000 },
    { table: "threads", rowCount: 1200, estimatedBytes: 10000000 },
    { table: "knowledge", rowCount: 8000, estimatedBytes: 100000000 },
  ],
};

const mockResources = {
  platform: "linux",
  uptimeSec: 86400,
  cpuCount: 4,
  loadAvg: [0.5, 0.8, 1.2],
  process: {
    rssBytes: 300000000,
    heapUsedBytes: 150000000,
    heapTotalBytes: 250000000,
    externalBytes: 50000000,
  },
  system: {
    totalMemBytes: 8000000000,
    freeMemBytes: 4000000000,
  },
};

let fetchMock: jest.Mock;

function setupFetch() {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : "";

    if (urlStr.includes("/api/config/db-management")) {
      if (opts?.method === "PUT") {
        const body = JSON.parse(opts.body as string);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ config: body }),
        });
      }
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              result: {
                mode: "manual",
                startedAt: "2025-01-01T00:00:00Z",
                completedAt: "2025-01-01T00:01:00Z",
                deletedLogs: 100,
                deletedThreads: 5,
                deletedMessages: 200,
                deletedAttachmentRows: 10,
                deletedFiles: 3,
                deletedOrphanFiles: 2,
              },
              storage: mockStorage,
            }),
        });
      }
      // GET
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            config: mockConfig,
            storage: mockStorage,
            resources: mockResources,
          }),
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

describe("DbManagementConfig — loading state", () => {
  test("shows loading text initially", async () => {
    setupFetch();
    const { DbManagementConfig } = await import("@/components/db-management-config");
    render(<DbManagementConfig />);
    expect(screen.getByText("Loading DB management settings...")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 2. DB SIZE & TABLE BREAKDOWN
// ════════════════════════════════════════════════════════════════

describe("DbManagementConfig — storage display", () => {
  test("renders DB size breakdown after loading", async () => {
    setupFetch();
    const { DbManagementConfig } = await import("@/components/db-management-config");
    await act(async () => {
      render(<DbManagementConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("DB Size and Table Breakdown")).toBeInTheDocument();
    });
  });

  test("renders table names and row counts", async () => {
    setupFetch();
    const { DbManagementConfig } = await import("@/components/db-management-config");
    await act(async () => {
      render(<DbManagementConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("messages")).toBeInTheDocument();
    });
    expect(screen.getByText("threads")).toBeInTheDocument();
    expect(screen.getByText("knowledge")).toBeInTheDocument();
    expect(screen.getByText("50,000")).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════
// 3. HOST RESOURCES
// ════════════════════════════════════════════════════════════════

describe("DbManagementConfig — host resources", () => {
  test("renders host resource snapshot", async () => {
    setupFetch();
    const { DbManagementConfig } = await import("@/components/db-management-config");
    await act(async () => {
      render(<DbManagementConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("Host Resource Snapshot")).toBeInTheDocument();
    });
    expect(screen.getByText("linux")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument(); // cpuCount
  });
});

// ════════════════════════════════════════════════════════════════
// 4. CLEANUP POLICY TOGGLES
// ════════════════════════════════════════════════════════════════

describe("DbManagementConfig — cleanup policy toggles", () => {
  test("renders cleanup toggle checkboxes", async () => {
    setupFetch();
    const { DbManagementConfig } = await import("@/components/db-management-config");
    await act(async () => {
      render(<DbManagementConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("Cleanup Policy and Recurring Job")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Enable recurring maintenance")).toBeInTheDocument();
    expect(screen.getByLabelText("Clean logs")).toBeInTheDocument();
    expect(screen.getByLabelText(/clean old threads/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/clean old attachment/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/clean orphan files/i)).toBeInTheDocument();
  });

  test("toggling checkbox changes its checked state", async () => {
    setupFetch();
    const { DbManagementConfig } = await import("@/components/db-management-config");
    await act(async () => {
      render(<DbManagementConfig />);
    });
    await waitFor(() => {
      expect(screen.getByLabelText(/clean orphan files/i)).toBeInTheDocument();
    });

    const orphanCheckbox = screen.getByLabelText(/clean orphan files/i) as HTMLInputElement;
    expect(orphanCheckbox.checked).toBe(false); // initially false in mockConfig

    await act(async () => {
      fireEvent.click(orphanCheckbox);
    });
    expect(orphanCheckbox.checked).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// 5. SAVE POLICY
// ════════════════════════════════════════════════════════════════

describe("DbManagementConfig — save policy", () => {
  test("Save Policy button calls PUT API", async () => {
    setupFetch();
    const { DbManagementConfig } = await import("@/components/db-management-config");
    await act(async () => {
      render(<DbManagementConfig />);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save Policy" })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Policy" }));
    });

    const putCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        url.includes("/api/config/db-management") && opts?.method === "PUT"
    );
    expect(putCalls.length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// 6. RUN CLEANUP NOW
// ════════════════════════════════════════════════════════════════

describe("DbManagementConfig — run cleanup", () => {
  test("Run Cleanup Now button calls POST API", async () => {
    setupFetch();
    const { DbManagementConfig } = await import("@/components/db-management-config");
    await act(async () => {
      render(<DbManagementConfig />);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Run Cleanup Now" })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run Cleanup Now" }));
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit?]) =>
        url.includes("/api/config/db-management") && opts?.method === "POST"
    );
    expect(postCalls.length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// 7. REFRESH SNAPSHOT
// ════════════════════════════════════════════════════════════════

describe("DbManagementConfig — refresh", () => {
  test("Refresh Snapshot button re-fetches data", async () => {
    setupFetch();
    const { DbManagementConfig } = await import("@/components/db-management-config");
    await act(async () => {
      render(<DbManagementConfig />);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Refresh Snapshot" })).toBeInTheDocument();
    });

    const callsBefore = fetchMock.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh Snapshot" }));
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

// ════════════════════════════════════════════════════════════════
// 8. RETENTION INPUTS
// ════════════════════════════════════════════════════════════════

describe("DbManagementConfig — retention inputs", () => {
  test("retention day inputs accept numeric values", async () => {
    setupFetch();
    const { DbManagementConfig } = await import("@/components/db-management-config");
    await act(async () => {
      render(<DbManagementConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("Cleanup Policy and Recurring Job")).toBeInTheDocument();
    });

    // Find the log retention input (initially 30)
    const inputs = screen.getAllByRole("textbox");
    // Retention inputs have numeric values
    const logRetentionInput = inputs.find(
      (input) => (input as HTMLInputElement).value === "30"
    ) as HTMLInputElement;
    expect(logRetentionInput).toBeDefined();

    await act(async () => {
      fireEvent.change(logRetentionInput, { target: { value: "60" } });
    });
    expect(logRetentionInput.value).toBe("60");
  });
});
