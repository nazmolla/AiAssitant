/**
 * Component tests for analytics dashboard rendering.
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

describe("AgentDashboard analytics", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  test("renders full analytics sections", async () => {
    render(<AgentDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Errors & Activities (Last 24h)")).toBeInTheDocument();
    });

    expect(screen.getByText("Sessions (Last 24h)")).toBeInTheDocument();
    expect(screen.getByText("Session Outcomes Over Time")).toBeInTheDocument();
    expect(screen.getByText("Resolution rate drivers")).toBeInTheDocument();
    expect(screen.getByText("Escalation rate drivers")).toBeInTheDocument();
    expect(screen.getByText("Abandon rate drivers")).toBeInTheDocument();
  });

  test("shows full date and time in log stream", async () => {
    render(<AgentDashboard />);

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    await waitFor(() => {
      expect(screen.getByText(/Agent Log Stream/)).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText(/Search logs, source, level, metadata/i)).toBeInTheDocument();

    // Date part + time part from ISO-backed mock formatter.
    expect(screen.getAllByText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/).length).toBeGreaterThan(0);
  });
});
