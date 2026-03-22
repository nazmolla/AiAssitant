/**
 * Component interaction tests for ChangePasswordSection.
 *
 * Validates:
 * - Renders hidden for non-local users (null returned from API)
 * - Renders the form for local users
 * - Validates required fields
 * - Validates password complexity rules
 * - Validates password match
 * - Submits successfully and clears fields
 * - Handles API error response
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "../helpers/setup-jsdom";
import { ChangePasswordSection } from "@/components/change-password-section";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock UI primitives
jest.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
jest.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

async function renderAsLocalUser() {
  // First call: /api/admin/users/me — returns local provider
  mockFetch.mockResolvedValueOnce({
    json: async () => ({ provider_id: "local" }),
    ok: true,
  } as unknown as Response);

  let container!: ReturnType<typeof render>;
  await act(async () => {
    container = render(<ChangePasswordSection />);
  });
  return container;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("ChangePasswordSection — visibility", () => {
  test("renders nothing for non-local users", async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ provider_id: "google" }),
      ok: true,
    } as unknown as Response);

    await act(async () => {
      render(<ChangePasswordSection />);
    });

    expect(screen.queryByTestId("card")).toBeNull();
  });

  test("renders the form for local users", async () => {
    await renderAsLocalUser();
    expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText("••••••••")).toHaveLength(3);
  });
});

describe("ChangePasswordSection — validation", () => {
  test("shows error when fields are empty", async () => {
    await renderAsLocalUser();
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    await waitFor(() => {
      expect(screen.getByText("All fields are required.")).toBeInTheDocument();
    });
  });

  test("shows error when new password is too short", async () => {
    await renderAsLocalUser();
    const inputs = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(inputs[0], { target: { value: "current" } });
    fireEvent.change(inputs[1], { target: { value: "Ab1!" } }); // < 8 chars
    fireEvent.change(inputs[2], { target: { value: "Ab1!" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    await waitFor(() => {
      expect(screen.getByText("New password must be at least 8 characters.")).toBeInTheDocument();
    });
  });

  test("shows error when passwords do not match", async () => {
    await renderAsLocalUser();
    const inputs = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(inputs[0], { target: { value: "currentPass" } });
    fireEvent.change(inputs[1], { target: { value: "NewPass1!" } });
    fireEvent.change(inputs[2], { target: { value: "DifferentPass1!" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    await waitFor(() => {
      expect(screen.getByText("New passwords do not match.")).toBeInTheDocument();
    });
  });
});

describe("ChangePasswordSection — submit", () => {
  test("shows success and clears fields on successful submit", async () => {
    await renderAsLocalUser();
    // Second fetch call: /api/auth/change-password
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: "Password changed successfully." }),
    } as unknown as Response);

    const inputs = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(inputs[0], { target: { value: "CurrentPass1!" } });
    fireEvent.change(inputs[1], { target: { value: "NewPass2@abc" } });
    fireEvent.change(inputs[2], { target: { value: "NewPass2@abc" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    await waitFor(() => {
      expect(screen.getByText("Password changed successfully.")).toBeInTheDocument();
    });
    // Fields should be cleared
    expect((inputs[0] as HTMLInputElement).value).toBe("");
  });

  test("shows error message on API failure", async () => {
    await renderAsLocalUser();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Current password is incorrect." }),
    } as unknown as Response);

    const inputs = screen.getAllByPlaceholderText("••••••••");
    fireEvent.change(inputs[0], { target: { value: "WrongPass1!" } });
    fireEvent.change(inputs[1], { target: { value: "NewPass2@abc" } });
    fireEvent.change(inputs[2], { target: { value: "NewPass2@abc" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    await waitFor(() => {
      expect(screen.getByText("Current password is incorrect.")).toBeInTheDocument();
    });
  });
});
