/**
 * Interaction tests for WhisperConfig.
 *
 * Tests: toggle enable, change URL, Save Configuration (PUT), Test Connection (POST).
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

let fetchMock: jest.Mock;

function setupFetch() {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/api/config/whisper")) {
      if (opts?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      }
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, detail: "server reachable" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ enabled: false, url: "http://localhost:8083", model: "whisper-1" }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("WhisperConfig — interactions", () => {
  test("Save Configuration calls PUT with form values", async () => {
    setupFetch();
    const { WhisperConfig } = await import("@/components/whisper-config");
    await act(async () => { render(<WhisperConfig />); });
    await waitFor(() => {
      expect(screen.getByText("Local Whisper Server")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save configuration/i }));
    });

    const putCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/whisper") && o?.method === "PUT"
    );
    expect(putCalls.length).toBe(1);
    const body = JSON.parse(putCalls[0][1].body as string);
    expect(body).toHaveProperty("url");
    expect(body).toHaveProperty("model");
  });

  test("toggling enable checkbox changes checked state", async () => {
    setupFetch();
    const { WhisperConfig } = await import("@/components/whisper-config");
    await act(async () => { render(<WhisperConfig />); });
    await waitFor(() => {
      expect(screen.getByText("Local Whisper Server")).toBeInTheDocument();
    });

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false); // initially disabled

    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(checkbox.checked).toBe(true);
  });

  test("Test Connection calls POST and shows success", async () => {
    setupFetch();
    const { WhisperConfig } = await import("@/components/whisper-config");
    await act(async () => { render(<WhisperConfig />); });
    await waitFor(() => {
      expect(screen.getByLabelText("Server URL")).toBeInTheDocument();
    });

    // URL field is pre-filled from GET mock, so button should be enabled
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([u, o]: [string, RequestInit?]) => u.includes("/api/config/whisper") && o?.method === "POST"
    );
    expect(postCalls.length).toBe(1);

    await waitFor(() => {
      expect(screen.getByText(/connection successful/i)).toBeInTheDocument();
    });
  });

  test("changing URL input updates value", async () => {
    setupFetch();
    const { WhisperConfig } = await import("@/components/whisper-config");
    await act(async () => { render(<WhisperConfig />); });
    await waitFor(() => {
      expect(screen.getByLabelText("Server URL")).toBeInTheDocument();
    });

    const urlInput = screen.getByLabelText("Server URL") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(urlInput, { target: { value: "http://newhost:9000" } });
    });
    expect(urlInput.value).toBe("http://newhost:9000");
  });

  test("shows success message after saving", async () => {
    setupFetch();
    const { WhisperConfig } = await import("@/components/whisper-config");
    await act(async () => { render(<WhisperConfig />); });
    await waitFor(() => {
      expect(screen.getByText("Local Whisper Server")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save configuration/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/local whisper configuration saved/i)).toBeInTheDocument();
    });
  });
});
