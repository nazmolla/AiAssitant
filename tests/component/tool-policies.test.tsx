/**
 * Component tests for ToolPolicies — tool approval / proactive toggles.
 *
 * Covers:
 * - Server names displayed (not GUIDs) when /api/mcp returns valid server list (Bug #4)
 * - Falls back to server ID when /api/mcp returns error (graceful degradation)
 * - Empty state when no tools discovered
 * - Tool grouping (builtin vs MCP)
 * - Toggle approval / proactive switches
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mock Data ────────────────────────────────────────────────────

const MOCK_SERVERS = [
  { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", name: "Home Assistant" },
  { id: "f9e8d7c6-b5a4-3210-fedc-ba0987654321", name: "GitHub MCP" },
];

const MOCK_TOOLS = [
  // Built-in tools
  { name: "web_search", description: "Search the web", source: "builtin", group: "Web Tools" },
  { name: "read_file", description: "Read a local file", source: "builtin", group: "File System" },
  // MCP tools — prefixed by server GUID
  { name: "a1b2c3d4-e5f6-7890-abcd-ef1234567890.turn_on_light", description: "Turn on a smart light", source: "mcp" },
  { name: "a1b2c3d4-e5f6-7890-abcd-ef1234567890.get_temperature", description: "Get current temperature", source: "mcp" },
  { name: "f9e8d7c6-b5a4-3210-fedc-ba0987654321.create_issue", description: "Create a GitHub issue", source: "mcp" },
];

const MOCK_POLICIES = [
  { tool_name: "web_search", mcp_id: null, requires_approval: 1, is_proactive_enabled: 0, scope: "global" },
  { tool_name: "read_file", mcp_id: null, requires_approval: 0, is_proactive_enabled: 0, scope: "global" },
  { tool_name: "a1b2c3d4-e5f6-7890-abcd-ef1234567890.turn_on_light", mcp_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", requires_approval: 1, is_proactive_enabled: 0, scope: "global" },
  { tool_name: "a1b2c3d4-e5f6-7890-abcd-ef1234567890.get_temperature", mcp_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", requires_approval: 0, is_proactive_enabled: 1, scope: "user" },
  { tool_name: "f9e8d7c6-b5a4-3210-fedc-ba0987654321.create_issue", mcp_id: "f9e8d7c6-b5a4-3210-fedc-ba0987654321", requires_approval: 1, is_proactive_enabled: 0, scope: "global" },
];

// ── Fetch Mock ───────────────────────────────────────────────────

function setupFetchMock(overrides: {
  servers?: unknown;
  tools?: unknown;
  policies?: unknown;
} = {}) {
  const serversResp = overrides.servers ?? MOCK_SERVERS;
  const toolsResp = overrides.tools ?? MOCK_TOOLS;
  const policiesResp = overrides.policies ?? MOCK_POLICIES;

  (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    const method = opts?.method ?? "GET";

    // GET /api/mcp/tools — tool definitions
    if (url.includes("/api/mcp/tools") && method === "GET") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(toolsResp),
      });
    }

    // GET /api/policies — tool policies
    if (url.includes("/api/policies") && method === "GET") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(policiesResp),
      });
    }

    // GET /api/mcp — server list (for name resolution)
    if (url.includes("/api/mcp") && method === "GET") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(serversResp),
      });
    }

    // POST /api/policies — toggle
    if (url.includes("/api/policies") && method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    }

    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// Suppress act() warnings from MUI
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const msg = String(args[0]);
    if (msg.includes("act(") || msg.includes("not wrapped")) return;
    originalError(...args);
  };
});
afterAll(() => {
  console.error = originalError;
});

import { ToolPolicies } from "@/components/tool-policies";

// ── Tests ────────────────────────────────────────────────────────

describe("ToolPolicies — server name resolution (Bug #4)", () => {
  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("MCP tool groups show server name, NOT GUID (Bug #4 regression)", async () => {
    render(<ToolPolicies />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText("Home Assistant")).toBeInTheDocument();
    });

    // Server names should appear as section headers
    expect(screen.getByText("GitHub MCP")).toBeInTheDocument();

    // GUIDs should NOT appear as visible section labels
    expect(screen.queryByText("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).not.toBeInTheDocument();
    expect(screen.queryByText("f9e8d7c6-b5a4-3210-fedc-ba0987654321")).not.toBeInTheDocument();
  });

  test("falls back to server ID when /api/mcp returns error (graceful degradation)", async () => {
    setupFetchMock({ servers: { error: "decryption failed" } });
    render(<ToolPolicies />);

    // Groups load collapsed — expand all to see tools
    await waitFor(() => {
      expect(screen.getByText(/a1b2c3d4/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Expand all"));

    // The tools themselves still appear — component doesn't crash
    await waitFor(() => {
      expect(screen.getByText("turn_on_light")).toBeInTheDocument();
    });
    expect(screen.getByText("create_issue")).toBeInTheDocument();
  });

  test("falls back gracefully when /api/mcp fetch throws (network error)", async () => {
    (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/mcp/tools")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_TOOLS) });
      }
      if (url.includes("/api/policies")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_POLICIES) });
      }
      if (url.includes("/api/mcp")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<ToolPolicies />);

    // Groups load collapsed — expand all, then verify tools render with GUID fallback
    await waitFor(() => {
      expect(screen.getByText("Expand all")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Expand all"));

    await waitFor(() => {
      expect(screen.getByText("turn_on_light")).toBeInTheDocument();
    });
  });
});

describe("ToolPolicies — tool grouping & display", () => {
  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("groups built-in tools by their group name", async () => {
    render(<ToolPolicies />);

    await waitFor(() => {
      expect(screen.getByText("Web Tools")).toBeInTheDocument();
    });

    expect(screen.getByText("File System")).toBeInTheDocument();
  });

  test("strips server ID prefix from MCP tool display names", async () => {
    render(<ToolPolicies />);

    // Groups load collapsed — expand all to see tool names
    await waitFor(() => {
      expect(screen.getByText("Expand all")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Expand all"));

    await waitFor(() => {
      expect(screen.getByText("turn_on_light")).toBeInTheDocument();
    });
    expect(screen.getByText("get_temperature")).toBeInTheDocument();
    expect(screen.getByText("create_issue")).toBeInTheDocument();
  });

  test("shows summary counts (tools, groups, requiring approval, proactive)", async () => {
    render(<ToolPolicies />);

    await waitFor(() => {
      expect(screen.getByText(/5 tools discovered/)).toBeInTheDocument();
    });

    expect(screen.getByText(/4 groups/)).toBeInTheDocument();
    expect(screen.getByText(/3 requiring approval/)).toBeInTheDocument();
    expect(screen.getByText(/1 proactive/)).toBeInTheDocument();
    expect(screen.getByText(/1 user-only/)).toBeInTheDocument();
  });

  test("supports global collapse all and expand all", async () => {
    render(<ToolPolicies />);

    // Groups start collapsed by default
    await waitFor(() => {
      expect(screen.getByText("Expand all")).toBeInTheDocument();
    });
    expect(screen.queryByText("turn_on_light")).not.toBeInTheDocument();

    // Expand all → tools become visible
    fireEvent.click(screen.getByText("Expand all"));

    await waitFor(() => {
      expect(screen.getByText("turn_on_light")).toBeInTheDocument();
    });

    // Collapse all → tools hidden again
    fireEvent.click(screen.getByText("Collapse all"));

    await waitFor(() => {
      expect(screen.queryByText("turn_on_light")).not.toBeInTheDocument();
    });
  });

  test("empty state shown when no tools exist", async () => {
    setupFetchMock({ tools: [] });
    render(<ToolPolicies />);

    await waitFor(() => {
      expect(screen.getByText(/No tools discovered yet/)).toBeInTheDocument();
    });
  });

  test("handles /api/mcp/tools returning non-array without crashing", async () => {
    setupFetchMock({ tools: { error: "Internal Server Error" } });
    render(<ToolPolicies />);

    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });

    // Should show empty state, not crash
    expect(screen.getByText(/No tools discovered yet/)).toBeInTheDocument();
  });
});

describe("ToolPolicies — toggle interactions", () => {
  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("toggling approval calls POST /api/policies", async () => {
    const { container } = render(<ToolPolicies />);

    // Groups load collapsed — expand all to access toggle switches
    await waitFor(() => {
      expect(screen.getByText("Expand all")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Expand all"));

    await waitFor(() => {
      expect(screen.getByText("web_search")).toBeInTheDocument();
    });

    // MUI Switch renders as <span class="MuiSwitch-root"> with a hidden <input>
    // Query the switch inputs directly via the container
    const switchInputs = container.querySelectorAll<HTMLInputElement>("input.MuiSwitch-input");
    expect(switchInputs.length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(switchInputs[0]);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/policies",
      expect.objectContaining({ method: "POST" })
    );
  });
});
