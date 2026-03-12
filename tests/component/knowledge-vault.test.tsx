/**
 * Interaction tests for KnowledgeVault.
 *
 * Tests: renders entries, delete entry (DELETE), edit entry (PUT),
 * source filter toggle, empty state.
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

const mockEntries = [
  { id: 1, entity: "User", attribute: "name", value: "Mohamed", source_type: "manual" as const, source_context: null, last_updated: "2025-01-01" },
  { id: 2, entity: "Server", attribute: "host", value: "192.168.0.1", source_type: "proactive" as const, source_context: null, last_updated: "2025-01-02" },
  { id: 3, entity: "App", attribute: "port", value: "3000", source_type: "chat" as const, source_context: null, last_updated: "2025-01-03" },
];

let fetchMock: jest.Mock;

function setupFetch(entries = mockEntries) {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/api/knowledge")) {
      if (opts?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (opts?.method === "PUT") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: entries, total: entries.length, limit: 100, offset: 0, hasMore: false }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("KnowledgeVault — interactions", () => {
  test("renders entries with entity and value", async () => {
    setupFetch();
    const { KnowledgeVault } = await import("@/components/knowledge-vault");
    await act(async () => { render(<KnowledgeVault />); });
    await waitFor(() => {
      expect(screen.getByText("Mohamed")).toBeInTheDocument();
    });
    expect(screen.getByText("Server")).toBeInTheDocument();
    expect(screen.getByText("3000")).toBeInTheDocument();
  });

  test("clicking Delete on an entry calls DELETE API", async () => {
    setupFetch();
    const { KnowledgeVault } = await import("@/components/knowledge-vault");
    await act(async () => { render(<KnowledgeVault />); });
    await waitFor(() => {
      expect(screen.getByText("Mohamed")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    const delCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/knowledge") && o?.method === "DELETE"
    );
    expect(delCalls.length).toBe(1);
    expect(delCalls[0][0]).toContain("id=1");
  });

  test("clicking Edit shows Save and Cancel buttons", async () => {
    setupFetch();
    const { KnowledgeVault } = await import("@/components/knowledge-vault");
    await act(async () => { render(<KnowledgeVault />); });
    await waitFor(() => {
      expect(screen.getByText("Mohamed")).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    await act(async () => {
      fireEvent.click(editButtons[0]);
    });

    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  test("source filter toggles show filtered entries", async () => {
    setupFetch();
    const { KnowledgeVault } = await import("@/components/knowledge-vault");
    await act(async () => { render(<KnowledgeVault />); });
    await waitFor(() => {
      expect(screen.getByText("Mohamed")).toBeInTheDocument();
    });

    // Click "Proactive" filter
    const proactiveBtn = screen.getByRole("button", { name: /proactive/i });
    await act(async () => {
      fireEvent.click(proactiveBtn);
    });

    // Only the proactive entry should be visible
    await waitFor(() => {
      expect(screen.queryByText("Mohamed")).not.toBeInTheDocument(); // manual
    });
    expect(screen.getByText("192.168.0.1")).toBeInTheDocument(); // proactive
  });

  test("empty state shows message when no entries", async () => {
    setupFetch([]);
    const { KnowledgeVault } = await import("@/components/knowledge-vault");
    await act(async () => { render(<KnowledgeVault />); });
    await waitFor(() => {
      expect(screen.getByText(/no knowledge captured yet/i)).toBeInTheDocument();
    });
  });
});
