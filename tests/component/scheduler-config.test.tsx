/**
 * Interaction tests for SchedulerConfig.
 *
 * Tests: render batch type buttons, open modal, fill parameters, change recurrence,
 * save calls POST, cancel closes modal, error message, success message.
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

let fetchMock: jest.Mock;

function setupFetch(options?: { ok?: boolean; error?: string }) {
  const ok = options?.ok ?? true;
  const error = options?.error;
  fetchMock = jest.fn().mockImplementation((_url: string, opts?: RequestInit) => {
    if (opts?.method === "POST") {
      if (ok) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "schedule-new" }) });
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: error || "Server error" }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("SchedulerConfig — interactions", () => {
  test("renders all four batch type buttons", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    expect(screen.getByText("New Proactive Scheduler")).toBeInTheDocument();
    expect(screen.getByText("New Knowledge Maintenance")).toBeInTheDocument();
    expect(screen.getByText("New Log Cleanup / Maintenance")).toBeInTheDocument();
    expect(screen.getByText("New Email Reading Batch")).toBeInTheDocument();
  });

  test("clicking a batch type button opens the modal", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    await act(async () => {
      fireEvent.click(screen.getByText("New Proactive Scheduler"));
    });

    // Modal should show batch type in title
    await waitFor(() => {
      expect(screen.getByText(/batch scheduler.*proactive/i)).toBeInTheDocument();
    });

    // OK and Cancel buttons
    expect(screen.getByRole("button", { name: /^ok$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  test("shows correct parameter fields based on batch type", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    // Open proactive modal
    await act(async () => {
      fireEvent.click(screen.getByText("New Proactive Scheduler"));
    });

    await waitFor(() => {
      expect(screen.getByText("Interval")).toBeInTheDocument();
      expect(screen.getByText("Calendar Sources")).toBeInTheDocument();
    });
  });

  test("filling parameters and clicking OK calls POST with correct payload", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    // Open proactive modal
    await act(async () => {
      fireEvent.click(screen.getByText("New Proactive Scheduler"));
    });

    await waitFor(() => {
      expect(screen.getByText("Interval")).toBeInTheDocument();
    });

    // Fill a parameter
    const paramInputs = screen.getAllByRole("textbox");
    // The first textbox in the modal should be a parameter field
    if (paramInputs.length > 0) {
      await act(async () => {
        fireEvent.change(paramInputs[0], { target: { value: "5 minute" } });
      });
    }

    // Click OK
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^ok$/i }));
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/scheduler/schedules") && o?.method === "POST"
    );
    expect(postCalls.length).toBe(1);
    const body = JSON.parse(postCalls[0][1].body as string);
    expect(body.batch_job_type).toBe("proactive");
    expect(body.name).toBeDefined();
    expect(body.trigger_type).toBe("interval");
    expect(body.trigger_expr).toBeDefined();
  });

  test("Cancel button closes the modal without calling POST", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    await act(async () => {
      fireEvent.click(screen.getByText("New Email Reading Batch"));
    });

    await waitFor(() => {
      expect(screen.getByText(/batch scheduler.*email/i)).toBeInTheDocument();
    });

    // Click Cancel
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    });

    // Modal should close — title should disappear
    await waitFor(() => {
      expect(screen.queryByText(/batch scheduler.*email/i)).not.toBeInTheDocument();
    });

    // No POST should have been made
    const postCalls = fetchMock.mock.calls.filter(
      ([, o]: [string, RequestInit?]) => o?.method === "POST"
    );
    expect(postCalls.length).toBe(0);
  });

  test("server error displays error message", async () => {
    setupFetch({ ok: false, error: "Schedule name already exists" });
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    await act(async () => {
      fireEvent.click(screen.getByText("New Proactive Scheduler"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^ok$/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^ok$/i }));
    });

    await waitFor(() => {
      expect(screen.getByText("Schedule name already exists")).toBeInTheDocument();
    });
  });

  test("successful save shows success message", async () => {
    setupFetch({ ok: true });
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    await act(async () => {
      fireEvent.click(screen.getByText("New Knowledge Maintenance"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^ok$/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^ok$/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/created successfully/i)).toBeInTheDocument();
    });
  });

  test("each batch type shows its own parameters", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    // Open cleanup modal
    await act(async () => {
      fireEvent.click(screen.getByText("New Log Cleanup / Maintenance"));
    });

    await waitFor(() => {
      expect(screen.getByText("Older Than (days)")).toBeInTheDocument();
      expect(screen.getByText("Retention Policy")).toBeInTheDocument();
    });
  });
});
