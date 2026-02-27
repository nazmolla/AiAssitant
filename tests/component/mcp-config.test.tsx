/**
 * Component tests for McpConfig — MCP server configuration panel.
 *
 * Covers:
 * - Server list renders when /api/mcp returns valid array
 * - Empty state when no servers configured
 * - Non-JSON response from connect handled gracefully (Bug #3)
 * - Add server form validation & success flow
 * - Decryption failure (null fields) renders without crash
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────

// Mock crypto.randomUUID for deterministic IDs
const MOCK_UUID = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
Object.defineProperty(globalThis.crypto, "randomUUID", {
  value: () => MOCK_UUID,
  writable: true,
});

/** Standard mock servers returned by /api/mcp */
const MOCK_SERVERS = [
  {
    id: "server-1",
    name: "Home Assistant",
    transport_type: "streamablehttp",
    command: null,
    args: null,
    env_vars: null,
    url: "http://homeassistant.local:8123/api/mcp",
    auth_type: "bearer",
    access_token: null,
    client_id: null,
    client_secret: null,
    connected: true,
  },
  {
    id: "server-2",
    name: "GitHub MCP",
    transport_type: "sse",
    command: null,
    args: null,
    env_vars: null,
    url: "http://192.168.0.10:8787",
    auth_type: "none",
    access_token: null,
    client_id: null,
    client_secret: null,
    connected: false,
  },
];

/** Set up global.fetch mock with URL-based routing */
function setupFetchMock(overrides: Record<string, unknown> = {}) {
  const serversResponse = overrides.servers ?? MOCK_SERVERS;
  const connectResponse = overrides.connect ?? { tools: [{ name: "tool_a" }, { name: "tool_b" }] };
  const connectOk = overrides.connectOk ?? true;
  const connectIsJson = overrides.connectIsJson ?? true;

  (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    const method = opts?.method ?? "GET";

    // GET /api/mcp — list servers
    if (url.includes("/api/mcp") && !url.includes("/connect") && !url.includes("/tools") && method === "GET") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(serversResponse),
      });
    }

    // POST /api/mcp — add server
    if (url.includes("/api/mcp") && !url.includes("/connect") && method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: MOCK_UUID }),
      });
    }

    // DELETE /api/mcp — delete server
    if (url.includes("/api/mcp") && method === "DELETE") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    }

    // POST /api/mcp/:id/connect — connect server
    if (url.includes("/connect") && method === "POST") {
      if (!connectIsJson) {
        // Simulate non-JSON response (Bug #3)
        return Promise.resolve({
          ok: false,
          status: 502,
          json: () => Promise.reject(new Error("Unexpected end of JSON input")),
        });
      }
      return Promise.resolve({
        ok: connectOk,
        status: connectOk ? 200 : 500,
        json: () => Promise.resolve(connectResponse),
      });
    }

    // DELETE /api/mcp/:id/connect — disconnect server
    if (url.includes("/connect") && method === "DELETE") {
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

import { McpConfig } from "@/components/mcp-config";

// ── Tests ────────────────────────────────────────────────────────

describe("McpConfig — server list rendering", () => {
  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renders configured servers from /api/mcp", async () => {
    render(<McpConfig />);

    // Server names appear twice (mobile + desktop layout)
    await waitFor(() => {
      expect(screen.getAllByText("Home Assistant").length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByText("GitHub MCP").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2 servers configured")).toBeInTheDocument();
  });

  test("shows connected/disconnected status badges", async () => {
    render(<McpConfig />);

    await waitFor(() => {
      expect(screen.getAllByText("Home Assistant").length).toBeGreaterThanOrEqual(1);
    });

    // MUI Chip renders badge text inside a span
    const badges = screen.getAllByText(/Connected|Disconnected/);
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  test("no server list card when /api/mcp returns empty array", async () => {
    setupFetchMock({ servers: [] });
    render(<McpConfig />);

    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });

    expect(screen.queryByText("Configured Servers")).not.toBeInTheDocument();
  });

  test("handles /api/mcp returning non-array gracefully", async () => {
    setupFetchMock({ servers: { error: "Internal Server Error" } });
    render(<McpConfig />);

    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });

    // Should NOT crash — server list simply won't appear
    expect(screen.queryByText("Configured Servers")).not.toBeInTheDocument();
    // But the add-server form still renders
    expect(screen.getByText("Add MCP Server")).toBeInTheDocument();
  });

  test("renders servers with null decrypted fields (access_token=null)", async () => {
    // This simulates what happens when decryptField returns null due to key mismatch (Bug #1/#2)
    const serversWithNulls = [{
      ...MOCK_SERVERS[0],
      access_token: null,
      client_secret: null,
    }];
    setupFetchMock({ servers: serversWithNulls });
    render(<McpConfig />);

    await waitFor(() => {
      expect(screen.getAllByText("Home Assistant").length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("McpConfig — add server and connect", () => {
  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Add & Connect button disabled until name and URL filled", async () => {
    render(<McpConfig />);

    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    const addButton = screen.getByRole("button", { name: /Add & Connect/i });
    expect(addButton).toBeDisabled();
  });

  test("successful add & connect shows tool count and clears form", async () => {
    setupFetchMock({ connect: { tools: [{ name: "t1" }, { name: "t2" }, { name: "t3" }] } });
    render(<McpConfig />);

    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Fill in form
    const inputs = screen.getAllByRole("textbox");
    // First input is display name
    fireEvent.change(inputs[0], { target: { value: "Test MCP" } });

    // Find URL input — look for the placeholder
    const urlInput = screen.getByPlaceholderText(/Server URL/i);
    fireEvent.change(urlInput, { target: { value: "http://test.local:8080/mcp" } });

    const addButton = screen.getByRole("button", { name: /Add & Connect/i });
    expect(addButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(addButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/Connected! Discovered 3 tools/)).toBeInTheDocument();
    });
  });

  test("connect failure with non-JSON response shows error (Bug #3)", async () => {
    setupFetchMock({ connectIsJson: false });
    render(<McpConfig />);

    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Fill in form
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "HA Server" } });
    const urlInput = screen.getByPlaceholderText(/Server URL/i);
    fireEvent.change(urlInput, { target: { value: "http://homeassistant.local:8123/api/mcp" } });

    const addButton = screen.getByRole("button", { name: /Add & Connect/i });
    await act(async () => {
      fireEvent.click(addButton);
    });

    await waitFor(() => {
      // Should show the fallback error message, NOT crash
      expect(screen.getByText(/Server returned non-JSON response/)).toBeInTheDocument();
    });
  });

  test("connect failure with JSON error shows error message", async () => {
    setupFetchMock({
      connectOk: false,
      connect: { error: "Connection timed out after 15000ms" },
    });
    render(<McpConfig />);

    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Bad Server" } });
    const urlInput = screen.getByPlaceholderText(/Server URL/i);
    fireEvent.change(urlInput, { target: { value: "http://bad.local/mcp" } });

    const addButton = screen.getByRole("button", { name: /Add & Connect/i });
    await act(async () => {
      fireEvent.click(addButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/Connection timed out/)).toBeInTheDocument();
    });
  });
});

describe("McpConfig — connect/disconnect existing", () => {
  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Connect button calls /api/mcp/:id/connect", async () => {
    render(<McpConfig />);

    await waitFor(() => {
      expect(screen.getAllByText("GitHub MCP").length).toBeGreaterThanOrEqual(1);
    });

    // Find the Connect button near GitHub MCP (disconnected server)
    const connectButtons = screen.getAllByRole("button", { name: /^Connect$/i });
    expect(connectButtons.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      fireEvent.click(connectButtons[0]);
    });

    // Verify fetch was called with the connect URL
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/connect"),
      expect.objectContaining({ method: "POST" })
    );
  });

  test("Remove button calls DELETE /api/mcp", async () => {
    render(<McpConfig />);

    await waitFor(() => {
      expect(screen.getAllByText("Home Assistant").length).toBeGreaterThanOrEqual(1);
    });

    const removeButtons = screen.getAllByRole("button", { name: /Remove/i });
    expect(removeButtons.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      fireEvent.click(removeButtons[0]);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("id=server-1"),
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
