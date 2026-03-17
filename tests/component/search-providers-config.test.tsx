/**
 * Interaction tests for SearchProvidersConfig.
 * @jest-environment jsdom
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

let fetchMock: jest.Mock;

function setupFetch() {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/api/config/search-providers")) {
      if (opts?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, providers: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          providers: [
            { type: "duckduckgo-html", label: "DuckDuckGo HTML", enabled: true, priority: 1, hasApiKey: false },
            { type: "duckduckgo-instant", label: "DuckDuckGo Instant", enabled: true, priority: 2, hasApiKey: false },
            { type: "brave", label: "Brave Search API", enabled: false, priority: 3, hasApiKey: false },
          ],
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("SearchProvidersConfig interactions", () => {
  test("renders providers from API", async () => {
    setupFetch();
    const { SearchProvidersConfig } = await import("@/components/search-providers-config");
    await act(async () => {
      render(<SearchProvidersConfig />);
    });

    await waitFor(() => {
      expect(screen.getByText("Web Search Providers")).toBeInTheDocument();
      expect(screen.getByText("DuckDuckGo HTML")).toBeInTheDocument();
      expect(screen.getByText("Brave Search API")).toBeInTheDocument();
    });
  });

  test("can enable brave, set priority, and save", async () => {
    setupFetch();
    const { SearchProvidersConfig } = await import("@/components/search-providers-config");
    await act(async () => {
      render(<SearchProvidersConfig />);
    });

    await waitFor(() => {
      expect(screen.getByText("Brave Search API")).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    await act(async () => {
      fireEvent.click(checkboxes[2]);
    });

    const priorityInputs = screen.getAllByRole("spinbutton");
    await act(async () => {
      fireEvent.change(priorityInputs[2], { target: { value: "1" } });
    });

    const keyInput = screen.getByPlaceholderText("Enter Brave API key") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(keyInput, { target: { value: "brv-secret" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save search providers/i }));
    });

    const putCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/search-providers") && o?.method === "PUT"
    );

    expect(putCalls.length).toBe(1);
    const body = JSON.parse(putCalls[0][1].body as string);
    const brave = body.providers.find((provider: { type: string }) => provider.type === "brave");
    expect(brave.enabled).toBe(true);
    expect(brave.priority).toBe(1);
    expect(brave.apiKey).toBe("brv-secret");
  });
});
