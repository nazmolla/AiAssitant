/**
 * Interaction tests for SchedulerConfig.
 *
 * Tests: render batch type buttons, open modal, correct parameter fields per type,
 * POST payload uses batch_type (not batch_job_type), all parameter inputs are selects,
 * cancel closes modal without POST, error/success messaging.
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, schedule_id: "schedule-new" }) });
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
    expect(screen.getByText("New System Maintenance")).toBeInTheDocument();
    expect(screen.getByText("New Email Reading Batch")).toBeInTheDocument();
    expect(screen.getByText("New Job Scout Pipeline")).toBeInTheDocument();
  });

  test("clicking a batch type button opens the modal with OK and Cancel buttons", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    await act(async () => {
      fireEvent.click(screen.getByText("New Proactive Scheduler"));
    });

    await waitFor(() => {
      expect(screen.getByText(/batch scheduler.*proactive/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /^ok$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  test("proactive batch shows no parameter fields (it has none)", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    await act(async () => {
      fireEvent.click(screen.getByText("New Proactive Scheduler"));
    });

    await waitFor(() => {
      expect(screen.getByText(/no parameters required/i)).toBeInTheDocument();
    });
  });

  test("maintenance batch shows no parameter fields (it has none)", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    await act(async () => {
      fireEvent.click(screen.getByText("New System Maintenance"));
    });

    await waitFor(() => {
      expect(screen.getByText(/no parameters required/i)).toBeInTheDocument();
    });
  });

  test("job_scout batch shows no parameter fields (it has none)", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    await act(async () => {
      fireEvent.click(screen.getByText("New Job Scout Pipeline"));
    });

    await waitFor(() => {
      expect(screen.getByText(/no parameters required/i)).toBeInTheDocument();
    });
  });

  test("email batch shows Max Messages dropdown", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    await act(async () => {
      fireEvent.click(screen.getByText("New Email Reading Batch"));
    });

    await waitFor(() => {
      expect(screen.getByText("Max Messages Per Run")).toBeInTheDocument();
    });
  });

  test("POST payload sends batch_type (not batch_job_type) and parameters (not batch_parameters)", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    await act(async () => {
      fireEvent.click(screen.getByText("New Email Reading Batch"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^ok$/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^ok$/i }));
    });

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        ([u, o]: [string, RequestInit?]) => u.includes("/api/scheduler/schedules") && o?.method === "POST"
      );
      expect(postCalls.length).toBe(1);
      const body = JSON.parse(postCalls[0][1].body as string);

      // Must use correct API field names
      expect(body).toHaveProperty("batch_type", "email");
      expect(body).not.toHaveProperty("batch_job_type");
      expect(body).toHaveProperty("parameters");
      expect(body).not.toHaveProperty("batch_parameters");

      // Parameters must contain the email-specific key with the selected value
      expect(body.parameters).toHaveProperty("maxMessages");
    });
  });

  test("maintenance POST payload includes empty parameters object", async () => {
    setupFetch();
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    await act(async () => {
      fireEvent.click(screen.getByText("New System Maintenance"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^ok$/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^ok$/i }));
    });

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        ([u, o]: [string, RequestInit?]) => u.includes("/api/scheduler/schedules") && o?.method === "POST"
      );
      expect(postCalls.length).toBe(1);
      const body = JSON.parse(postCalls[0][1].body as string);
      expect(body.batch_type).toBe("maintenance");
      expect(body.parameters).toEqual({});
    });
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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    });

    await waitFor(() => {
      expect(screen.queryByText(/batch scheduler.*email/i)).not.toBeInTheDocument();
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([, o]: [string, RequestInit?]) => o?.method === "POST"
    );
    expect(postCalls.length).toBe(0);
  });

  test("server error message is displayed", async () => {
    setupFetch({ ok: false, error: "batch_type must be one of proactive|knowledge|cleanup|email|job_scout" });
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
      expect(screen.getByText(/batch_type must be one of/i)).toBeInTheDocument();
    });
  });

  test("successful save shows success message", async () => {
    setupFetch({ ok: true });
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    await act(async () => { render(<SchedulerConfig />); });

    await act(async () => {
      fireEvent.click(screen.getByText("New System Maintenance"));
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
});
