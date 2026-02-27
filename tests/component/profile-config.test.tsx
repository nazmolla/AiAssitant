/**
 * Component render tests for ProfileConfig, specifically the
 * ChangePasswordSection added for local-auth users.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: { user: { email: "test@example.com", id: "user-1" }, expires: "2099-01-01" },
    status: "authenticated",
  })),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "ember", setTheme: jest.fn(),
    font: "inter", setFont: jest.fn(),
    timezone: "UTC", setTimezone: jest.fn(),
    formatDate: (d: string) => d,
  }),
  THEMES: [{ id: "ember", label: "Ember", description: "Bold red", swatch: "hsl(0 85% 60%)" }],
  FONTS: [{ id: "inter", label: "Inter", description: "Default", preview: "'Inter', sans-serif" }],
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Default: local user (should see password section)
const mockFetch = jest.fn().mockImplementation((url: string) => {
  if (url.includes("/api/config/profile")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        display_name: "Test User", theme: "ember", font: "inter",
        timezone: "UTC", notification_level: "disaster",
      }),
    });
  }
  if (url.includes("/api/admin/users/me")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ role: "user", provider_id: "local" }),
    });
  }
  if (url.includes("/api/auth/change-password")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, message: "Password changed successfully." }),
    });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
});
global.fetch = mockFetch;

// Mock Intl.supportedValuesOf for timezone picker
if (!Intl.supportedValuesOf) {
  (Intl as Record<string, unknown>).supportedValuesOf = () => ["UTC", "America/New_York"];
}

import { ProfileConfig } from "@/components/profile-config";

// ── Tests ────────────────────────────────────────────────────────

describe("ProfileConfig", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  test("renders without throwing", async () => {
    expect(() => render(<ProfileConfig />)).not.toThrow();
  });

  test("renders personal information fields", async () => {
    render(<ProfileConfig />);
    await waitFor(() => {
      expect(screen.getByText("Personal Information")).toBeInTheDocument();
    });
  });

  test("renders Save Profile button", async () => {
    render(<ProfileConfig />);
    await waitFor(() => {
      expect(screen.getByText("Save Profile")).toBeInTheDocument();
    });
  });
});

describe("ChangePasswordSection", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    // Reset to local user
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/admin/users/me")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ role: "user", provider_id: "local" }),
        });
      }
      if (url.includes("/api/config/profile")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ display_name: "Test", theme: "ember", font: "inter" }),
        });
      }
      if (url.includes("/api/auth/change-password")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, message: "Password changed successfully." }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  test("renders Change Password section for local users", async () => {
    render(<ProfileConfig />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  test("does NOT render Change Password for OAuth users", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/admin/users/me")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ role: "user", provider_id: "azure-ad" }),
        });
      }
      if (url.includes("/api/config/profile")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ display_name: "OAuth User" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<ProfileConfig />);

    // Give time for the fetch to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(screen.queryByRole("heading", { name: "Change Password" })).not.toBeInTheDocument();
  });

  test("shows validation error when passwords don't match", async () => {
    render(<ProfileConfig />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
    }, { timeout: 3000 });

    // Fill in the password fields
    const passwordInputs = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(passwordInputs[0], { target: { value: "OldPass1!" } });
    fireEvent.change(passwordInputs[1], { target: { value: "NewPass1!" } });
    fireEvent.change(passwordInputs[2], { target: { value: "Different1!" } });

    // Click change password button
    fireEvent.click(screen.getByRole("button", { name: "Change Password" }));

    await waitFor(() => {
      expect(screen.getByText("New passwords do not match.")).toBeInTheDocument();
    });
  });

  test("shows validation error for short password", async () => {
    render(<ProfileConfig />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
    }, { timeout: 3000 });

    const passwordInputs = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(passwordInputs[0], { target: { value: "oldpass123" } });
    fireEvent.change(passwordInputs[1], { target: { value: "short" } });
    fireEvent.change(passwordInputs[2], { target: { value: "short" } });

    fireEvent.click(screen.getByRole("button", { name: "Change Password" }));

    await waitFor(() => {
      expect(screen.getByText("New password must be at least 8 characters.")).toBeInTheDocument();
    });
  });

  test("shows validation error for password without uppercase", async () => {
    render(<ProfileConfig />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
    }, { timeout: 3000 });

    const passwordInputs = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(passwordInputs[0], { target: { value: "OldPass1!" } });
    fireEvent.change(passwordInputs[1], { target: { value: "nouppercas1!" } });
    fireEvent.change(passwordInputs[2], { target: { value: "nouppercas1!" } });

    fireEvent.click(screen.getByRole("button", { name: "Change Password" }));

    await waitFor(() => {
      expect(screen.getByText("New password must contain at least one uppercase letter.")).toBeInTheDocument();
    });
  });

  test("submits password change and shows success message", async () => {
    render(<ProfileConfig />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
    }, { timeout: 3000 });

    const passwordInputs = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(passwordInputs[0], { target: { value: "OldPass1!" } });
    fireEvent.change(passwordInputs[1], { target: { value: "NewPass1!" } });
    fireEvent.change(passwordInputs[2], { target: { value: "NewPass1!" } });

    fireEvent.click(screen.getByRole("button", { name: "Change Password" }));

    await waitFor(() => {
      expect(screen.getByText("Password changed successfully.")).toBeInTheDocument();
    });

    // Verify the API was called correctly
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/auth/change-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ currentPassword: "OldPass1!", newPassword: "NewPass1!" }),
      })
    );
  });
});
