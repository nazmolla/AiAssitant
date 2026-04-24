/**
 * Interaction tests for KrakenConfig.
 *
 * Tests: renders not-configured state, save form flow, update flow,
 * delete confirmation flow.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

let fetchMock: jest.Mock;

function setupFetch(hasCredentials = false) {
  const statusResponse = hasCredentials
    ? { hasCredentials: true, apiKeyPrefix: "myapike1", updatedAt: "2026-01-01T00:00:00Z" }
    : { hasCredentials: false, apiKeyPrefix: null, updatedAt: null };

  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/api/config/integrations/kraken")) {
      if (opts?.method === "PUT") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      if (opts?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(statusResponse) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("KrakenConfig — not configured state", () => {
  test("renders without throwing and shows 'Not configured' badge", async () => {
    setupFetch(false);
    const { KrakenConfig } = await import("@/components/kraken-config");
    render(<KrakenConfig />);
    await waitFor(() => {
      expect(screen.getByText(/not configured/i)).toBeInTheDocument();
    });
  });

  test("clicking 'Add credentials' shows the credential form", async () => {
    setupFetch(false);
    const { KrakenConfig } = await import("@/components/kraken-config");
    render(<KrakenConfig />);
    await waitFor(() => screen.getByRole("button", { name: /add credentials/i }));
    fireEvent.click(screen.getByRole("button", { name: /add credentials/i }));
    expect(screen.getByPlaceholderText(/your kraken api key/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/your kraken api secret/i)).toBeInTheDocument();
  });

  test("Save button is disabled until both key and secret are filled", async () => {
    setupFetch(false);
    const { KrakenConfig } = await import("@/components/kraken-config");
    render(<KrakenConfig />);
    await waitFor(() => screen.getByRole("button", { name: /add credentials/i }));
    fireEvent.click(screen.getByRole("button", { name: /add credentials/i }));

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/your kraken api key/i), { target: { value: "abc" } });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/your kraken api secret/i), { target: { value: "secret" } });
    expect(saveBtn).not.toBeDisabled();
  });

  test("submitting the form calls PUT with apiKey and apiSecret", async () => {
    setupFetch(false);
    const { KrakenConfig } = await import("@/components/kraken-config");
    render(<KrakenConfig />);
    await waitFor(() => screen.getByRole("button", { name: /add credentials/i }));
    fireEvent.click(screen.getByRole("button", { name: /add credentials/i }));

    fireEvent.change(screen.getByPlaceholderText(/your kraken api key/i), { target: { value: "mykey" } });
    fireEvent.change(screen.getByPlaceholderText(/your kraken api secret/i), { target: { value: "mysecret" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        (c: unknown[]) => typeof c[1] === "object" && (c[1] as RequestInit).method === "PUT"
      );
      expect(putCall).toBeTruthy();
      const body = JSON.parse((putCall![1] as RequestInit).body as string);
      expect(body.apiKey).toBe("mykey");
      expect(body.apiSecret).toBe("mysecret");
    });
  });
});

describe("KrakenConfig — connected state", () => {
  test("renders 'Connected' badge and shows key prefix", async () => {
    setupFetch(true);
    const { KrakenConfig } = await import("@/components/kraken-config");
    render(<KrakenConfig />);
    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeInTheDocument();
      expect(screen.getByText(/myapike1…/i)).toBeInTheDocument();
    });
  });

  test("clicking 'Update credentials' shows the form", async () => {
    setupFetch(true);
    const { KrakenConfig } = await import("@/components/kraken-config");
    render(<KrakenConfig />);
    await waitFor(() => screen.getByRole("button", { name: /update credentials/i }));
    fireEvent.click(screen.getByRole("button", { name: /update credentials/i }));
    expect(screen.getByPlaceholderText(/your kraken api key/i)).toBeInTheDocument();
  });

  test("clicking Remove asks for confirmation", async () => {
    setupFetch(true);
    const { KrakenConfig } = await import("@/components/kraken-config");
    render(<KrakenConfig />);
    await waitFor(() => screen.getByRole("button", { name: /^remove$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(screen.getByText(/remove credentials\?/i)).toBeInTheDocument();
  });

  test("confirming delete calls DELETE endpoint", async () => {
    setupFetch(true);
    const { KrakenConfig } = await import("@/components/kraken-config");
    render(<KrakenConfig />);
    await waitFor(() => screen.getByRole("button", { name: /^remove$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      const delCall = fetchMock.mock.calls.find(
        (c: unknown[]) => typeof c[1] === "object" && (c[1] as RequestInit).method === "DELETE"
      );
      expect(delCall).toBeTruthy();
    });
  });

  test("cancelling delete hides confirmation", async () => {
    setupFetch(true);
    const { KrakenConfig } = await import("@/components/kraken-config");
    render(<KrakenConfig />);
    await waitFor(() => screen.getByRole("button", { name: /^remove$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByText(/remove credentials\?/i)).not.toBeInTheDocument();
  });
});
