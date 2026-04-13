/**
 * Component tests for AgentDashboard (redesigned layout).
 *
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/hooks/use-is-mobile", () => ({ useIsMobile: () => false }));

jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    formatDate: (value: string | number | Date) => {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return String(value);
      return d.toISOString().replace("T", " ").slice(0, 19);
    },
  }),
}));

const now = new Date();
const logs = [
  {
    id: 1,
    level: "error",
    source: "agent",
    message: "Failed to process request",
    metadata: JSON.stringify({ sessionId: "s-1", topic: "payment" }),
    created_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
  },
  {
    id: 2,
    level: "warning",
    source: "mcp",
    message: "Escalated to operator",
    metadata: JSON.stringify({ sessionId: "s-1", topic: "payment" }),
    created_at: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
  },
  {
    id: 3,
    level: "verbose",
    source: "thought",
    message: "Resolved after retry",
    metadata: JSON.stringify({ sessionId: "s-2", topic: "device" }),
    created_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
  },
];

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => logs,
}) as unknown as typeof fetch;

import { AgentDashboard } from "@/components/agent-dashboard";

describe("AgentDashboard", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  test("renders dashboard title and live indicator", async () => {
    render(<AgentDashboard />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  test("renders KPI labels", async () => {
    render(<AgentDashboard />);
    await waitFor(() => {
      expect(screen.getByText("Sessions")).toBeInTheDocument();
    });
    expect(screen.getByText("Resolution")).toBeInTheDocument();
    expect(screen.getByText("Escalation")).toBeInTheDocument();
    expect(screen.getByText("CSAT")).toBeInTheDocument();
  });

  test("renders metric sidebar sections", async () => {
    render(<AgentDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/System health/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Log breakdown/i)).toBeInTheDocument();
    expect(screen.getByText(/Activity/i)).toBeInTheDocument();
    expect(screen.getByText(/Session outcomes/i)).toBeInTheDocument();
  });

  test("log stream is always visible without tab switching", async () => {
    render(<AgentDashboard />);
    await waitFor(() => {
      expect(screen.getByText("Live Logs")).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText(/Search logs, source, level, metadata/i)).toBeInTheDocument();
  });

  test("log messages are rendered in the stream", async () => {
    render(<AgentDashboard />);
    await waitFor(() => {
      expect(screen.getByText("Failed to process request")).toBeInTheDocument();
    });
    expect(screen.getByText("Escalated to operator")).toBeInTheDocument();
    expect(screen.getByText("Resolved after retry")).toBeInTheDocument();
  });

  test("timestamps are rendered in log rows", async () => {
    render(<AgentDashboard />);
    await waitFor(() => {
      // formatDate mock returns full datetime; at least one should appear
      const timestamps = screen.getAllByText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
      expect(timestamps.length).toBeGreaterThan(0);
    });
  });

  test("log breakdown pills filter the stream on click", async () => {
    render(<AgentDashboard />);
    await waitFor(() => {
      expect(screen.getByText("Live Logs")).toBeInTheDocument();
    });

    // Click 'Error' pill — only error logs should remain visible
    const errorPill = screen.getByText(/Error\s+\d+/);
    fireEvent.click(errorPill);

    await waitFor(() => {
      expect(screen.getByText("Failed to process request")).toBeInTheDocument();
    });
    // warning log should be filtered out
    expect(screen.queryByText("Escalated to operator")).not.toBeInTheDocument();
  });

  test("search field filters log stream", async () => {
    render(<AgentDashboard />);
    await waitFor(() => {
      expect(screen.getByText("Failed to process request")).toBeInTheDocument();
    });

    const search = screen.getByPlaceholderText(/Search logs/i);
    fireEvent.change(search, { target: { value: "retry" } });

    await waitFor(() => {
      expect(screen.getByText("Resolved after retry")).toBeInTheDocument();
    });
    expect(screen.queryByText("Failed to process request")).not.toBeInTheDocument();
  });

  test("refresh button triggers a fetch", async () => {
    render(<AgentDashboard />);
    await waitFor(() => {
      expect(screen.getByText("Live Logs")).toBeInTheDocument();
    });

    const initialCallCount = (global.fetch as jest.Mock).mock.calls.length;
    const refreshBtn = screen.getAllByRole("button").find(
      (btn) => btn.querySelector("svg[data-testid='RefreshIcon']") || btn.getAttribute("aria-label")?.includes("efresh"),
    );
    // The icon button inside the log header triggers a manual refresh
    const allButtons = screen.getAllByRole("button");
    fireEvent.click(allButtons[allButtons.length - 1]); // last button = refresh in log header
    await waitFor(() => {
      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });
});
