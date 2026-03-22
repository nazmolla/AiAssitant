/**
 * Interaction tests for AuthConfig.
 *
 * Tests: configure provider (POST), update provider (PATCH), toggle enable/disable (PATCH),
 * delete provider (DELETE + confirm), form validation, cancel edit.
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

// AuthConfig embeds ApiKeysConfig — mock it to isolate tests
jest.mock("@/components/api-keys-config", () => ({
  ApiKeysConfig: () => <div data-testid="api-keys-config">API Keys Mock</div>,
}));

let mockOpenConfirm: jest.Mock = jest.fn();
jest.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => ({ confirmDialog: null, openConfirm: mockOpenConfirm }),
}));

const mockAzureProvider = {
  id: "auth-1",
  provider_type: "azure-ad",
  label: "Azure AD",
  client_id: "client-id-123",
  has_client_secret: true,
  tenant_id: "tenant-id-456",
  has_bot_token: false,
  application_id: null,
  enabled: true,
  created_at: "2025-01-01T00:00:00Z",
};

let fetchMock: jest.Mock;

function setupFetch(providers: typeof mockAzureProvider[] = []) {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("/api/config/auth")) {
      if (opts?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "auth-new" }) });
      }
      if (opts?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (opts?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(providers) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

beforeEach(() => {
  mockOpenConfirm = jest.fn();
});

afterEach(() => jest.restoreAllMocks());

describe("AuthConfig — interactions", () => {
  test("renders provider cards with correct labels", async () => {
    setupFetch([]);
    const { AuthConfig } = await import("@/components/auth-config");
    await act(async () => { render(<AuthConfig />); });
    await waitFor(() => {
      expect(screen.getByText("OAuth Providers")).toBeInTheDocument();
    });
    // All three provider types should render
    expect(screen.getAllByText("Azure AD").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("Discord Bot")).toBeInTheDocument();
  });

  test("unconfigured provider shows 'Not Configured' and 'Configure' button", async () => {
    setupFetch([]);
    const { AuthConfig } = await import("@/components/auth-config");
    await act(async () => { render(<AuthConfig />); });
    await waitFor(() => {
      expect(screen.getByText("OAuth Providers")).toBeInTheDocument();
    });
    // All three should show "Not Configured"
    expect(screen.getAllByText("Not Configured").length).toBe(3);
    // "Configure" buttons
    expect(screen.getAllByRole("button", { name: /configure/i }).length).toBe(3);
  });

  test("Configure button opens form with required fields", async () => {
    setupFetch([]);
    const { AuthConfig } = await import("@/components/auth-config");
    await act(async () => { render(<AuthConfig />); });
    await waitFor(() => {
      expect(screen.getByText("OAuth Providers")).toBeInTheDocument();
    });

    // Click Configure on Azure AD
    const configureBtns = screen.getAllByRole("button", { name: /configure/i });
    await act(async () => { fireEvent.click(configureBtns[0]); });

    // Form should show fields
    expect(screen.getByText("Client ID")).toBeInTheDocument();
    expect(screen.getByText("Client Secret")).toBeInTheDocument();
    expect(screen.getByText("Tenant ID")).toBeInTheDocument();
    // Save and Cancel buttons
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  test("submitting Configure form calls POST with correct payload", async () => {
    setupFetch([]);
    const { AuthConfig } = await import("@/components/auth-config");
    await act(async () => { render(<AuthConfig />); });
    await waitFor(() => {
      expect(screen.getByText("OAuth Providers")).toBeInTheDocument();
    });

    // Open Azure AD form
    const configureBtns = screen.getAllByRole("button", { name: /configure/i });
    await act(async () => { fireEvent.click(configureBtns[0]); });

    // Fill form fields — use getAllByPlaceholderText since Client ID and Tenant ID share same placeholder
    const uuidInputs = screen.getAllByPlaceholderText("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");

    // First UUID field = Client ID, second = Tenant ID
    await act(async () => {
      fireEvent.change(uuidInputs[0], { target: { value: "my-client-id" } });
    });

    // Find the password inputs (Client Secret)
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    if (passwordInputs.length > 0) {
      await act(async () => {
        fireEvent.change(passwordInputs[0], { target: { value: "my-secret" } });
      });
    }

    // Fill Tenant ID (the second UUID input)
    if (uuidInputs.length > 1) {
      await act(async () => {
        fireEvent.change(uuidInputs[1], { target: { value: "my-tenant-id" } });
      });
    }

    // Submit
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/auth") && o?.method === "POST"
    );
    expect(postCalls.length).toBe(1);
    const body = JSON.parse(postCalls[0][1].body as string);
    expect(body.provider_type).toBe("azure-ad");
    expect(body.enabled).toBe(true);
  });

  test("configured provider shows 'Active' badge and toggle switch", async () => {
    setupFetch([mockAzureProvider]);
    const { AuthConfig } = await import("@/components/auth-config");
    let container: HTMLElement;
    await act(async () => { ({ container } = render(<AuthConfig />)); });
    await waitFor(() => {
      expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(1);
    });

    // Toggle switch should be present
    const switches = container!.querySelectorAll('input[type="checkbox"]');
    expect(switches.length).toBeGreaterThanOrEqual(1);
  });

  test("toggle switch calls PATCH with enabled toggled", async () => {
    setupFetch([mockAzureProvider]);
    const { AuthConfig } = await import("@/components/auth-config");
    let container: HTMLElement;
    await act(async () => { ({ container } = render(<AuthConfig />)); });
    await waitFor(() => {
      expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(1);
    });

    const switches = container!.querySelectorAll('input[type="checkbox"]');
    await act(async () => { fireEvent.click(switches[0]); });

    const patchCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/auth") && o?.method === "PATCH"
    );
    expect(patchCalls.length).toBe(1);
    const body = JSON.parse(patchCalls[0][1].body as string);
    expect(body.id).toBe("auth-1");
    expect(body.enabled).toBe(false);
  });

  test("Remove button calls DELETE after window.confirm", async () => {
    setupFetch([mockAzureProvider]);
    mockOpenConfirm.mockResolvedValue(true);
    const { AuthConfig } = await import("@/components/auth-config");
    await act(async () => { render(<AuthConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(1);
    });

    const removeBtn = screen.getByRole("button", { name: /remove/i });
    await act(async () => { fireEvent.click(removeBtn); });

    expect(mockOpenConfirm).toHaveBeenCalled();
    await waitFor(() => {
      const delCalls = fetchMock.mock.calls.filter(
        ([u, o]: [string, RequestInit?]) => u.includes("/api/config/auth") && o?.method === "DELETE"
      );
      expect(delCalls.length).toBe(1);
      expect(delCalls[0][0]).toContain("id=auth-1");
    });
  });

  test("Remove button does NOT call DELETE when confirm is cancelled", async () => {
    setupFetch([mockAzureProvider]);
    mockOpenConfirm.mockResolvedValue(false);
    const { AuthConfig } = await import("@/components/auth-config");
    await act(async () => { render(<AuthConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(1);
    });

    const removeBtn = screen.getByRole("button", { name: /remove/i });
    await act(async () => { fireEvent.click(removeBtn); });

    await new Promise((r) => setTimeout(r, 50));
    const delCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/auth") && o?.method === "DELETE"
    );
    expect(delCalls.length).toBe(0);
  });

  test("Edit button opens form, Cancel closes it", async () => {
    setupFetch([mockAzureProvider]);
    const { AuthConfig } = await import("@/components/auth-config");
    await act(async () => { render(<AuthConfig />); });
    await waitFor(() => {
      expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(1);
    });

    const editBtn = screen.getByRole("button", { name: /^edit$/i });
    await act(async () => { fireEvent.click(editBtn); });

    // Save and Cancel buttons should appear
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();

    // Cancel
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /cancel/i })); });

    // Edit button should reappear
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  test("form validation prevents save when required fields are missing", async () => {
    setupFetch([]);
    const { AuthConfig } = await import("@/components/auth-config");
    await act(async () => { render(<AuthConfig />); });
    await waitFor(() => {
      expect(screen.getByText("OAuth Providers")).toBeInTheDocument();
    });

    // Open Azure AD form
    const configureBtns = screen.getAllByRole("button", { name: /configure/i });
    await act(async () => { fireEvent.click(configureBtns[0]); });

    // Submit without filling fields
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    });

    // Should show validation error
    await waitFor(() => {
      expect(screen.getByText(/is required/i)).toBeInTheDocument();
    });

    // POST should NOT have been called
    const postCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/auth") && o?.method === "POST"
    );
    expect(postCalls.length).toBe(0);
  });
});
