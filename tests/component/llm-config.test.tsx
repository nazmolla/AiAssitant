/**
 * Interaction tests for LlmConfig.
 *
 * Tests: add provider (POST), set default (PATCH), delete provider (DELETE + confirm),
 * edit provider (PATCH), form validation, empty state.
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

// jsdom doesn't support scrollIntoView
Element.prototype.scrollIntoView = jest.fn();

const mockProvider = {
  id: "prov-1",
  label: "My Azure GPT",
  provider_type: "azure-openai" as const,
  purpose: "chat" as const,
  config: { endpoint: "https://example.openai.azure.com", deployment: "gpt-4o", apiVersion: "2024-08-01", apiKey: "••••••" },
  is_default: true,
  created_at: "2025-01-01T00:00:00Z",
  has_api_key: true,
};

const secondProvider = {
  id: "prov-2",
  label: "OpenAI Fallback",
  provider_type: "openai" as const,
  purpose: "chat" as const,
  config: { model: "gpt-4o", apiKey: "••••••" },
  is_default: false,
  created_at: "2025-01-02T00:00:00Z",
  has_api_key: true,
};

let fetchMock: jest.Mock;

function setupFetch(providers = [mockProvider, secondProvider]) {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("/api/config/llm")) {
      if (opts?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "new-1" }) });
      }
      if (opts?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (opts?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      // GET
      return Promise.resolve({ ok: true, json: () => Promise.resolve(providers) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("LlmConfig — interactions", () => {
  test("renders provider list and shows default badge", async () => {
    setupFetch();
    const { LlmConfig } = await import("@/components/llm-config");
    await act(async () => { render(<LlmConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("My Azure GPT").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText("OpenAI Fallback").length).toBeGreaterThanOrEqual(1);
    // Default provider should show "Default" badge
    expect(screen.getAllByText("Default").length).toBeGreaterThanOrEqual(1);
    // Non-default should show "Standby"
    expect(screen.getAllByText("Standby").length).toBeGreaterThanOrEqual(1);
  });

  test("submitting form calls POST with correct payload", async () => {
    setupFetch([]);
    const { LlmConfig } = await import("@/components/llm-config");
    await act(async () => { render(<LlmConfig />); });
    await waitFor(() => {
      expect(screen.getByText("Add LLM Provider")).toBeInTheDocument();
    });

    // Fill Display Label
    const labelInput = screen.getByPlaceholderText("e.g., Primary Azure");
    await act(async () => { fireEvent.change(labelInput, { target: { value: "Test Provider" } }); });

    // Fill required config fields for azure-openai (default provider type)
    // API Key is a password field with no placeholder
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    expect(passwordInputs.length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      fireEvent.change(passwordInputs[0], { target: { value: "sk-test-key" } });
    });

    const endpointInput = screen.getByPlaceholderText("https://YOUR-RESOURCE.openai.azure.com");
    const deploymentInput = screen.getByPlaceholderText("gpt-4o");

    await act(async () => {
      fireEvent.change(endpointInput, { target: { value: "https://myresource.openai.azure.com" } });
      fireEvent.change(deploymentInput, { target: { value: "gpt-4o" } });
    });

    // Submit form
    const saveBtn = screen.getByRole("button", { name: /save provider/i });
    await act(async () => { fireEvent.click(saveBtn); });

    const postCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/llm") && o?.method === "POST"
    );
    expect(postCalls.length).toBe(1);
    const body = JSON.parse(postCalls[0][1].body as string);
    expect(body.label).toBe("Test Provider");
    expect(body.provider_type).toBe("azure-openai");
    expect(body.purpose).toBe("chat");
    expect(body.config.endpoint).toBe("https://myresource.openai.azure.com");
    expect(body.config.deployment).toBe("gpt-4o");
  });

  test("Make Default button calls PATCH with is_default", async () => {
    setupFetch();
    const { LlmConfig } = await import("@/components/llm-config");
    await act(async () => { render(<LlmConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("OpenAI Fallback").length).toBeGreaterThanOrEqual(1);
    });

    // Find "Make Default" button — should only appear for non-default providers
    const makeDefaultBtns = screen.getAllByRole("button", { name: /make default/i });
    expect(makeDefaultBtns.length).toBeGreaterThanOrEqual(1);

    await act(async () => { fireEvent.click(makeDefaultBtns[0]); });

    const patchCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/llm") && o?.method === "PATCH"
    );
    expect(patchCalls.length).toBe(1);
    const body = JSON.parse(patchCalls[0][1].body as string);
    expect(body.id).toBe("prov-2");
    expect(body.is_default).toBe(true);
  });

  test("Remove button calls DELETE after window.confirm", async () => {
    setupFetch();
    window.confirm = jest.fn(() => true);
    const { LlmConfig } = await import("@/components/llm-config");
    await act(async () => { render(<LlmConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("My Azure GPT").length).toBeGreaterThanOrEqual(1);
    });

    const removeBtns = screen.getAllByRole("button", { name: /remove/i });
    expect(removeBtns.length).toBeGreaterThanOrEqual(1);

    await act(async () => { fireEvent.click(removeBtns[0]); });

    expect(window.confirm).toHaveBeenCalled();

    const delCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/llm") && o?.method === "DELETE"
    );
    expect(delCalls.length).toBe(1);
    expect(delCalls[0][0]).toContain("id=prov-1");
  });

  test("Remove button does NOT call DELETE when confirm is cancelled", async () => {
    setupFetch();
    window.confirm = jest.fn(() => false);
    const { LlmConfig } = await import("@/components/llm-config");
    await act(async () => { render(<LlmConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("My Azure GPT").length).toBeGreaterThanOrEqual(1);
    });

    const removeBtns = screen.getAllByRole("button", { name: /remove/i });
    await act(async () => { fireEvent.click(removeBtns[0]); });

    const delCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/llm") && o?.method === "DELETE"
    );
    expect(delCalls.length).toBe(0);
  });

  test("Edit button populates form and changes heading to 'Edit LLM Provider'", async () => {
    setupFetch();
    const { LlmConfig } = await import("@/components/llm-config");
    await act(async () => { render(<LlmConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("My Azure GPT").length).toBeGreaterThanOrEqual(1);
    });

    const editBtns = screen.getAllByRole("button", { name: /^edit$/i });
    expect(editBtns.length).toBeGreaterThanOrEqual(1);
    await act(async () => { fireEvent.click(editBtns[0]); });

    // Heading should change
    expect(screen.getByText("Edit LLM Provider")).toBeInTheDocument();
    // Update Provider button should appear
    expect(screen.getByRole("button", { name: /update provider/i })).toBeInTheDocument();
    // Cancel Edit button should appear
    expect(screen.getByRole("button", { name: /cancel edit/i })).toBeInTheDocument();
  });

  test("Cancel Edit resets form back to 'Add LLM Provider'", async () => {
    setupFetch();
    const { LlmConfig } = await import("@/components/llm-config");
    await act(async () => { render(<LlmConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("My Azure GPT").length).toBeGreaterThanOrEqual(1);
    });

    const editBtns = screen.getAllByRole("button", { name: /^edit$/i });
    await act(async () => { fireEvent.click(editBtns[0]); });
    expect(screen.getByText("Edit LLM Provider")).toBeInTheDocument();

    const cancelBtn = screen.getByRole("button", { name: /cancel edit/i });
    await act(async () => { fireEvent.click(cancelBtn); });

    expect(screen.getByText("Add LLM Provider")).toBeInTheDocument();
  });

  test("empty state shows 'No providers yet'", async () => {
    setupFetch([]);
    const { LlmConfig } = await import("@/components/llm-config");
    await act(async () => { render(<LlmConfig />); });
    await waitFor(() => {
      expect(screen.getByText("No providers yet")).toBeInTheDocument();
    });
  });

  test("shows success message after saving", async () => {
    setupFetch([]);
    const { LlmConfig } = await import("@/components/llm-config");
    await act(async () => { render(<LlmConfig />); });
    await waitFor(() => {
      expect(screen.getByText("Add LLM Provider")).toBeInTheDocument();
    });

    const labelInput = screen.getByPlaceholderText("e.g., Primary Azure");
    const endpointInput = screen.getByPlaceholderText("https://YOUR-RESOURCE.openai.azure.com");
    const deploymentInput = screen.getByPlaceholderText("gpt-4o");
    const passwordInputs = document.querySelectorAll('input[type="password"]');

    await act(async () => {
      fireEvent.change(labelInput, { target: { value: "New Provider" } });
      fireEvent.change(passwordInputs[0], { target: { value: "sk-test" } });
      fireEvent.change(endpointInput, { target: { value: "https://test.openai.azure.com" } });
      fireEvent.change(deploymentInput, { target: { value: "gpt-4o" } });
    });

    const saveBtn = screen.getByRole("button", { name: /save provider/i });
    await act(async () => { fireEvent.click(saveBtn); });

    await waitFor(() => {
      expect(screen.getByText(/saved\./i)).toBeInTheDocument();
    });
  });
});
