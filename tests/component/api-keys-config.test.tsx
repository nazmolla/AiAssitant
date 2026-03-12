/**
 * Interaction tests for ApiKeysConfig.
 *
 * Tests: toggle form, create key (POST), revoke flow (DELETE), scope toggles.
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

const existingKey = {
  id: "k1",
  user_id: "admin-1",
  name: "Test Key",
  key_prefix: "nxa_abc",
  scopes: '["chat","knowledge"]',
  expires_at: null,
  last_used_at: null,
  created_at: "2025-01-01T00:00:00Z",
};

let fetchMock: jest.Mock;

function setupFetch(keys = [existingKey]) {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/api/config/api-keys")) {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ rawKey: "nxa_newkey123456", id: "k2", ...existingKey }),
        });
      }
      if (opts?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(keys) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("ApiKeysConfig — interactions", () => {
  test("clicking '+ New API Key' shows creation form", async () => {
    setupFetch();
    const { ApiKeysConfig } = await import("@/components/api-keys-config");
    await act(async () => { render(<ApiKeysConfig />); });
    await waitFor(() => {
      expect(screen.getByText("+ New API Key")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("+ New API Key"));
    });

    expect(screen.getByText("Create API Key")).toBeInTheDocument();
    expect(screen.getByText("Key Name")).toBeInTheDocument();
  });

  test("Create Key button calls POST with name and scopes", async () => {
    setupFetch();
    const { ApiKeysConfig } = await import("@/components/api-keys-config");
    await act(async () => { render(<ApiKeysConfig />); });
    await waitFor(() => {
      expect(screen.getByText("+ New API Key")).toBeInTheDocument();
    });

    // Open form
    await act(async () => {
      fireEvent.click(screen.getByText("+ New API Key"));
    });

    // Fill name
    const nameInput = screen.getByPlaceholderText(/mobile app/i);
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "My Script" } });
    });

    // Click Create Key
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create key/i }));
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/api-keys") && o?.method === "POST"
    );
    expect(postCalls.length).toBe(1);
    const body = JSON.parse(postCalls[0][1].body as string);
    expect(body.name).toBe("My Script");
    expect(body.scopes).toContain("chat");
  });

  test("reveals raw key after creation", async () => {
    setupFetch();
    const { ApiKeysConfig } = await import("@/components/api-keys-config");
    await act(async () => { render(<ApiKeysConfig />); });
    await waitFor(() => {
      expect(screen.getByText("+ New API Key")).toBeInTheDocument();
    });

    await act(async () => { fireEvent.click(screen.getByText("+ New API Key")); });
    const nameInput = screen.getByPlaceholderText(/mobile app/i);
    await act(async () => { fireEvent.change(nameInput, { target: { value: "My Key" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /create key/i })); });

    await waitFor(() => {
      expect(screen.getByText(/nxa_newkey123456/)).toBeInTheDocument();
    });
    expect(screen.getByText(/copy it now/i)).toBeInTheDocument();
  });

  test("Revoke flow: click Revoke then Confirm calls DELETE", async () => {
    setupFetch();
    const { ApiKeysConfig } = await import("@/components/api-keys-config");
    await act(async () => { render(<ApiKeysConfig />); });
    await waitFor(() => {
      expect(screen.getByText("Test Key")).toBeInTheDocument();
    });

    // Click Revoke
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /revoke/i }));
    });

    // Confirm step
    expect(screen.getByText("Revoke?")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    });

    const delCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/api-keys") && o?.method === "DELETE"
    );
    expect(delCalls.length).toBe(1);
    expect(JSON.parse(delCalls[0][1].body as string).id).toBe("k1");
  });

  test("Revoke flow: clicking Cancel does not call DELETE", async () => {
    setupFetch();
    const { ApiKeysConfig } = await import("@/components/api-keys-config");
    await act(async () => { render(<ApiKeysConfig />); });
    await waitFor(() => {
      expect(screen.getByText("Test Key")).toBeInTheDocument();
    });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /revoke/i })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /cancel/i })); });

    const delCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/api-keys") && o?.method === "DELETE"
    );
    expect(delCalls.length).toBe(0);
  });

  test("empty state shows 'No API keys yet'", async () => {
    setupFetch([]);
    const { ApiKeysConfig } = await import("@/components/api-keys-config");
    await act(async () => { render(<ApiKeysConfig />); });
    await waitFor(() => {
      expect(screen.getByText("No API keys yet.")).toBeInTheDocument();
    });
  });

  test("scope toggle buttons change selection", async () => {
    setupFetch();
    const { ApiKeysConfig } = await import("@/components/api-keys-config");
    await act(async () => { render(<ApiKeysConfig />); });
    await waitFor(() => {
      expect(screen.getByText("+ New API Key")).toBeInTheDocument();
    });

    // Open form
    await act(async () => { fireEvent.click(screen.getByText("+ New API Key")); });

    // "chat" is initially selected, click "knowledge" to add it
    const knowledgeBtn = screen.getByRole("button", { name: /knowledge/i });
    await act(async () => { fireEvent.click(knowledgeBtn); });

    // The scope description should now include knowledge
    expect(screen.getByText(/read and manage knowledge vault/i)).toBeInTheDocument();
  });
});
