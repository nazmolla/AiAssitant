/**
 * Interaction tests for LoggingConfig.
 *
 * Tests: save min level (PUT), clear all logs (DELETE), change level select.
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

function setupFetch() {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/api/config/logging")) {
      if (opts?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ min_level: "warning" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ min_level: "verbose" }),
      });
    }
    if (url.includes("/api/logs") && opts?.method === "DELETE") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ deleted: 42 }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("LoggingConfig — interactions", () => {
  test("Save Logging Policy calls PUT with selected level", async () => {
    setupFetch();
    const { LoggingConfig } = await import("@/components/logging-config");
    await act(async () => { render(<LoggingConfig />); });
    await waitFor(() => {
      expect(screen.getByText("Server Logging Policy")).toBeInTheDocument();
    });

    // Change the select to "error"
    const select = screen.getAllByRole("combobox")[0]; // first select = min level
    await act(async () => {
      fireEvent.change(select, { target: { value: "error" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save logging policy/i }));
    });

    const putCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/logging") && o?.method === "PUT"
    );
    expect(putCalls.length).toBe(1);
    expect(JSON.parse(putCalls[0][1].body as string).min_level).toBe("error");
  });

  test("Clear All Logs calls DELETE with mode 'all'", async () => {
    setupFetch();
    const { LoggingConfig } = await import("@/components/logging-config");
    await act(async () => { render(<LoggingConfig />); });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /clear all logs/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /clear all logs/i }));
    });

    const delCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/logs") && o?.method === "DELETE"
    );
    expect(delCalls.length).toBe(1);
    expect(JSON.parse(delCalls[0][1].body as string).mode).toBe("all");
  });

  test("shows success message after saving", async () => {
    setupFetch();
    const { LoggingConfig } = await import("@/components/logging-config");
    await act(async () => { render(<LoggingConfig />); });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save logging policy/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save logging policy/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/minimum log level updated/i)).toBeInTheDocument();
    });
  });

  test("shows deleted count message after clearing logs", async () => {
    setupFetch();
    const { LoggingConfig } = await import("@/components/logging-config");
    await act(async () => { render(<LoggingConfig />); });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /clear all logs/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /clear all logs/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/deleted 42 log entries/i)).toBeInTheDocument();
    });
  });
});
