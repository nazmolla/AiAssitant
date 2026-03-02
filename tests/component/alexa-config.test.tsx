/**
 * Component render tests for AlexaConfig settings panel.
 *
 * Tests:
 * - Renders without throwing
 * - Shows "Not Configured" when no creds stored
 * - Shows masked credentials when configured
 * - Edit form appears and validates inputs
 * - Tools info card displays 14 tools
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: { user: { email: "admin@test.com", id: "admin-1", role: "admin" }, expires: "2099-01-01" },
    status: "authenticated",
  })),
}));

let fetchHandler: (url: string, init?: RequestInit) => Promise<Response>;

const mockFetch = jest.fn().mockImplementation(
  (url: string, init?: RequestInit) => fetchHandler(url, init)
);
global.fetch = mockFetch as unknown as typeof fetch;

import { AlexaConfig } from "@/components/alexa-config";

// ── Helpers ──────────────────────────────────────────────────────

function setupNotConfigured() {
  fetchHandler = async (url: string) => {
    if (url.includes("/api/config/alexa")) {
      return { ok: true, json: async () => ({ configured: false, ubidMain: "", atMain: "" }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  };
}

function setupConfigured() {
  fetchHandler = async (url: string, init?: RequestInit) => {
    if (url.includes("/api/config/alexa") && (!init || init.method !== "PUT")) {
      return {
        ok: true,
        json: async () => ({
          configured: true,
          ubidMain: "abcdef•••7890",
          atMain: "Atza|lon•••cdef",
        }),
      } as Response;
    }
    if (url.includes("/api/config/alexa") && init?.method === "PUT") {
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("AlexaConfig", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  test("renders without throwing", () => {
    setupNotConfigured();
    expect(() => render(<AlexaConfig />)).not.toThrow();
  });

  test("shows 'Not Configured' when credentials are absent", async () => {
    setupNotConfigured();
    render(<AlexaConfig />);

    await waitFor(() => {
      expect(screen.getByText(/Not Configured/)).toBeInTheDocument();
    });
  });

  test("shows input fields when not configured", async () => {
    setupNotConfigured();
    render(<AlexaConfig />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/UBID_MAIN cookie/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Atza\|/)).toBeInTheDocument();
    });
  });

  test("shows masked credentials when configured", async () => {
    setupConfigured();
    render(<AlexaConfig />);

    await waitFor(() => {
      expect(screen.getByText(/Credentials Configured/)).toBeInTheDocument();
      expect(screen.getByText("abcdef•••7890")).toBeInTheDocument();
      expect(screen.getByText("Atza|lon•••cdef")).toBeInTheDocument();
    });
  });

  test("shows 'Update Credentials' button when configured", async () => {
    setupConfigured();
    render(<AlexaConfig />);

    await waitFor(() => {
      expect(screen.getByText("Update Credentials")).toBeInTheDocument();
    });
  });

  test("clicking 'Update Credentials' shows edit form", async () => {
    setupConfigured();
    render(<AlexaConfig />);

    await waitFor(() => {
      expect(screen.getByText("Update Credentials")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Update Credentials"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/UBID_MAIN cookie/i)).toBeInTheDocument();
      expect(screen.getByText("Save Credentials")).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });
  });

  test("displays tools info card with 14 tools", async () => {
    setupNotConfigured();
    render(<AlexaConfig />);

    await waitFor(() => {
      expect(screen.getByText("Available Tools (14)")).toBeInTheDocument();
    });

    // Verify some tool descriptions are present
    expect(screen.getByText(/Announce on devices/)).toBeInTheDocument();
    expect(screen.getByText(/bedroom state/i)).toBeInTheDocument();
    expect(screen.getByText(/List \/ control lights/)).toBeInTheDocument();
    expect(screen.getByText(/DND status/i)).toBeInTheDocument();
  });

  test("shows Alexa Smart Home title", async () => {
    setupNotConfigured();
    render(<AlexaConfig />);

    await waitFor(() => {
      expect(screen.getByText("Alexa Smart Home")).toBeInTheDocument();
    });
  });

  test("shows validation message when saving with empty fields", async () => {
    setupNotConfigured();
    render(<AlexaConfig />);

    await waitFor(() => {
      expect(screen.getByText("Save Credentials")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Save Credentials"));

    await waitFor(() => {
      expect(screen.getByText("Both fields are required.")).toBeInTheDocument();
    });
  });

  test("cancel button hides edit form", async () => {
    setupConfigured();
    render(<AlexaConfig />);

    await waitFor(() => {
      expect(screen.getByText("Update Credentials")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Update Credentials"));

    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => {
      expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
      expect(screen.getByText("Update Credentials")).toBeInTheDocument();
    });
  });
});
