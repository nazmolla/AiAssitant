/**
 * Interaction tests for VoiceProfileConfig component.
 *
 * Tests: render enrolled/unenrolled states, record button, delete flow.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock getUserMedia — not available in jsdom
Object.defineProperty(global.navigator, "mediaDevices", {
  value: {
    getUserMedia: jest.fn().mockResolvedValue({
      getTracks: () => [{ stop: jest.fn() }],
    }),
  },
  configurable: true,
});

// Mock MediaRecorder
class MockMediaRecorder {
  state = "inactive";
  mimeType = "audio/webm";
  stream = { getTracks: () => [{ stop: jest.fn() }] };
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.onstop?.(); }
}
(global as unknown as Record<string, unknown>).MediaRecorder = MockMediaRecorder;
(MockMediaRecorder as unknown as { isTypeSupported: () => boolean }).isTypeSupported = () => false;

let fetchMock: jest.Mock;

function setupFetch(enrolled: boolean) {
  fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/api/voice/enroll")) {
      if (opts?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ enrolled: true }) });
      }
      if (opts?.method === "DELETE") {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ enrolled, enrolledAt: enrolled ? "2026-01-01T00:00:00Z" : null }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;
}

afterEach(() => jest.restoreAllMocks());

describe("VoiceProfileConfig — interactions", () => {
  test("renders 'Not enrolled' state when no profile", async () => {
    setupFetch(false);
    const { VoiceProfileConfig } = await import("@/components/voice-profile-config");
    await act(async () => { render(<VoiceProfileConfig />); });
    await waitFor(() => {
      expect(screen.getByText("Not enrolled")).toBeInTheDocument();
    });
  });

  test("renders 'Voice profile enrolled' when enrolled", async () => {
    setupFetch(true);
    const { VoiceProfileConfig } = await import("@/components/voice-profile-config");
    await act(async () => { render(<VoiceProfileConfig />); });
    await waitFor(() => {
      expect(screen.getByText("Voice profile enrolled")).toBeInTheDocument();
    });
  });

  test("Start Recording button is present when not enrolled", async () => {
    setupFetch(false);
    const { VoiceProfileConfig } = await import("@/components/voice-profile-config");
    await act(async () => { render(<VoiceProfileConfig />); });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Start Recording/i })).toBeInTheDocument();
    });
  });

  test("Remove Profile button shows confirmation when enrolled", async () => {
    setupFetch(true);
    const { VoiceProfileConfig } = await import("@/components/voice-profile-config");
    await act(async () => { render(<VoiceProfileConfig />); });
    await waitFor(() => expect(screen.getByText("Voice profile enrolled")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove Profile/i }));
    });

    expect(screen.getByRole("button", { name: /Confirm Remove/i })).toBeInTheDocument();
  });

  test("Confirm Remove calls DELETE /api/voice/enroll", async () => {
    setupFetch(true);
    const { VoiceProfileConfig } = await import("@/components/voice-profile-config");
    await act(async () => { render(<VoiceProfileConfig />); });
    await waitFor(() => expect(screen.getByText("Voice profile enrolled")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove Profile/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirm Remove/i }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/voice/enroll",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("Re-enroll button visible when enrolled", async () => {
    setupFetch(true);
    const { VoiceProfileConfig } = await import("@/components/voice-profile-config");
    await act(async () => { render(<VoiceProfileConfig />); });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Re-enroll/i })).toBeInTheDocument();
    });
  });
});
