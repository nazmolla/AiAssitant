/**
 * Component tests — TTS-to-Listening Transition
 *
 * Verifies that when TTS audio finishes playing, the ConversationMode
 * component transitions immediately to the correct state:
 *  - Auto-listen ON  → "listening" (via "idle" → startListening)
 *  - Auto-listen OFF → "idle"
 *
 * Also tests that the state never gets stuck on "speaking" after TTS ends.
 *
 * Uses jest.useFakeTimers() so VAD setInterval callbacks and all
 * timeouts run inside act(), preventing React "not wrapped in act" warnings
 * and ensuring state updates flush predictably.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";

/* ─── Framework mocks ────────────────────────────────────────────── */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => "/conversation",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: { user: { email: "user@test.com", id: "user-1" }, expires: "2099-01-01" },
    status: "authenticated",
  })),
  signOut: jest.fn(),
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

/* ─── Browser API mocks ──────────────────────────────────────────── */

/** Captured Audio instance — lets tests fire onended/onerror on demand */
let capturedAudio: {
  play: jest.Mock;
  pause: jest.Mock;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  onloadedmetadata: (() => void) | null;
  duration: number;
  currentTime: number;
  src: string;
} | null = null;

// Mock Audio constructor
const OriginalAudio = globalThis.Audio;
beforeAll(() => {
  // @ts-expect-error — replacing global Audio
  globalThis.Audio = jest.fn().mockImplementation(() => {
    capturedAudio = {
      play: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      onended: null,
      onerror: null,
      onloadedmetadata: null,
      duration: 2.5,
      currentTime: 0,
      src: "",
    };
    return capturedAudio;
  });
});
afterAll(() => {
  globalThis.Audio = OriginalAudio;
});

/** Create a fake MediaStream */
function createFakeMediaStream(): MediaStream {
  const track = {
    stop: jest.fn(), kind: "audio", enabled: true, id: "fake-track",
    readyState: "live", addEventListener: jest.fn(), removeEventListener: jest.fn(),
  };
  return {
    getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [],
    addTrack: jest.fn(), removeTrack: jest.fn(), clone: jest.fn(),
    id: "fake-stream", active: true,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
    onaddtrack: null, onremovetrack: null,
  } as unknown as MediaStream;
}

/** Mock MediaRecorder */
let capturedRecorder: {
  start: jest.Mock; stop: jest.Mock;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  state: string; mimeType: string;
} | null = null;

// @ts-expect-error — replacing global
globalThis.MediaRecorder = jest.fn().mockImplementation(() => {
  capturedRecorder = {
    start: jest.fn().mockImplementation(() => {
      if (capturedRecorder) capturedRecorder.state = "recording";
    }),
    stop: jest.fn().mockImplementation(() => {
      if (capturedRecorder) {
        capturedRecorder.state = "inactive";
        // Fire ondataavailable with a blob >= 100 bytes, then onstop
        const fakeAudioData = new Uint8Array(256).fill(0xff);
        setTimeout(() => {
          capturedRecorder?.ondataavailable?.({ data: new Blob([fakeAudioData], { type: "audio/webm" }) });
          capturedRecorder?.onstop?.();
        }, 5);
      }
    }),
    ondataavailable: null, onstop: null,
    state: "inactive", mimeType: "audio/webm",
  };
  return capturedRecorder;
});
// @ts-expect-error — static method
MediaRecorder.isTypeSupported = jest.fn().mockReturnValue(true);

/** Control VAD signal: "speech" = loud, "silence" = quiet */
let vadSignal: "speech" | "silence" = "silence";

// @ts-expect-error — replacing global AudioContext
globalThis.AudioContext = jest.fn().mockImplementation(() => ({
  createMediaStreamSource: jest.fn().mockReturnValue({ connect: jest.fn(), disconnect: jest.fn() }),
  createAnalyser: jest.fn().mockReturnValue({
    fftSize: 2048,
    getFloatTimeDomainData: jest.fn().mockImplementation((dataArray: Float32Array) => {
      const value = vadSignal === "speech" ? 0.5 : 0.001;
      for (let i = 0; i < dataArray.length; i++) dataArray[i] = value;
    }),
    connect: jest.fn(), disconnect: jest.fn(),
  }),
  close: jest.fn().mockResolvedValue(undefined),
  state: "running",
}));

/** Build SSE text from events */
function buildSSE(events: Array<{ event: string; data: unknown }>): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
}

/**
 * Create a mock SSE response with a readable body.
 * jsdom does not provide global Response, so we return plain objects
 * that match the interface the component uses: .ok, .status, .json(), .blob(), .body.getReader().
 */
function makeSseResponse(events: Array<{ event: string; data: unknown }>) {
  const sseText = buildSSE(events);
  const encoded = new TextEncoder().encode(sseText);
  let consumed = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (!consumed) {
            consumed = true;
            return { value: encoded, done: false };
          }
          return { value: undefined, done: true };
        },
        cancel: jest.fn(),
        releaseLock: jest.fn(),
      }),
    },
  };
}

function makeJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function makeBlobResponse(content: string, type = "audio/mpeg", status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: async () => new Blob([content], { type }),
  };
}

/** Mock fetch for STT, LLM SSE, and TTS */
function setupFetchMock() {
  globalThis.fetch = jest.fn().mockImplementation(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("/api/audio/transcribe")) {
      return makeJsonResponse({ text: "Hello Nexus" });
    }
    if (u.includes("/api/conversation/respond")) {
      return makeSseResponse([
        { event: "token", data: "Hi " },
        { event: "token", data: "there!" },
        { event: "done", data: { content: "Hi there!" } },
      ]);
    }
    if (u.includes("/api/audio/tts")) {
      return makeBlobResponse("fake-tts");
    }
    return makeJsonResponse({ error: "Not found" }, 404);
  }) as jest.Mock;
}

const mockGetUserMedia = jest.fn().mockResolvedValue(createFakeMediaStream());
Object.defineProperty(navigator, "mediaDevices", {
  value: { getUserMedia: mockGetUserMedia }, configurable: true, writable: true,
});
globalThis.URL.createObjectURL = jest.fn().mockReturnValue("blob:fake-url");
globalThis.URL.revokeObjectURL = jest.fn();

afterEach(() => {
  cleanup();
  capturedAudio = null;
  capturedRecorder = null;
  vadSignal = "silence";
});

import { ConversationMode } from "@/components/conversation-mode";

/* ═══════════════════════════════════════════════════════════════════ */
/*  Helpers — all timer advancement happens inside act()             */
/* ═══════════════════════════════════════════════════════════════════ */

/** Click the mic button and flush the async startListening */
async function clickMicAndStartListening() {
  const micButton = screen.getByTestId("MicIcon").closest("button")!;
  await act(async () => {
    fireEvent.click(micButton);
  });
  // Flush getUserMedia() promise + rest of startListening setup
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

/**
 * Simulate the full VAD cycle: speech → silence → end-of-speech detection.
 * Then flush through processAudio (STT → LLM → setState("speaking") → playTts).
 * Returns with the component in "speaking" state and capturedAudio ready for onended.
 */
async function simulateFullCycleToSpeaking() {
  // 1. Speech for 600ms (> MIN_SPEECH_DURATION_MS = 400ms)
  vadSignal = "speech";
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });

  // 2. Silence for 1400ms (> SILENCE_DURATION_MS = 1200ms)
  //    VAD fires stopRecordingForProcessing at ~1200ms of silence
  vadSignal = "silence";
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1400);
  });

  // 3. Flush recorder.stop() setTimeout(5ms) → ondataavailable → onstop → processAudio
  //    processAudio: fetch STT → fetch LLM SSE → read stream → setState("speaking") → playTts
  //    playTts: fetch TTS → Audio.play()
  //    Total flushing: advance a small amount repeatedly to let promise chains resolve
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
  }
}

/** Fire Audio.onended and flush the restartListening setTimeout(300ms) + startListening */
async function finishTtsAndFlush() {
  // Fire onended
  await act(async () => {
    capturedAudio?.onended?.();
  });
  // Flush restartListening's setTimeout(300ms) + startListening's async getUserMedia
  await act(async () => {
    await jest.advanceTimersByTimeAsync(400);
  });
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  Tests                                                            */
/* ═══════════════════════════════════════════════════════════════════ */

describe("ConversationMode — TTS to Listening Transition", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setupFetchMock();
    mockGetUserMedia.mockResolvedValue(createFakeMediaStream());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("auto-listen ON: speaking → listening after TTS audio ends", async () => {
    render(<ConversationMode />);
    expect(screen.getByText("Ready to talk")).toBeInTheDocument();

    // Start listening
    await clickMicAndStartListening();
    expect(screen.getByText("Listening...")).toBeInTheDocument();

    // VAD cycle → processing → thinking → speaking
    await simulateFullCycleToSpeaking();
    expect(screen.getAllByText(/Speaking/).length).toBeGreaterThan(0);

    // TTS finishes → should go to listening (auto-listen ON by default)
    await finishTtsAndFlush();
    expect(screen.getByText("Listening...")).toBeInTheDocument();
    expect(screen.queryByText("Speaking...")).not.toBeInTheDocument();
  });

  test("auto-listen OFF: speaking → idle after TTS audio ends", async () => {
    render(<ConversationMode />);

    // Toggle auto-listen OFF
    fireEvent.click(screen.getByText("Auto"));
    expect(screen.getByText("Manual")).toBeInTheDocument();

    await clickMicAndStartListening();
    expect(screen.getByText("Listening...")).toBeInTheDocument();

    await simulateFullCycleToSpeaking();
    expect(screen.getAllByText(/Speaking/).length).toBeGreaterThan(0);

    await finishTtsAndFlush();

    // Should be idle, NOT listening or speaking
    expect(screen.getByText("Ready to talk")).toBeInTheDocument();
    expect(screen.queryByText("Speaking...")).not.toBeInTheDocument();
    expect(screen.queryByText("Listening...")).not.toBeInTheDocument();
  });

  test("state never stuck on 'speaking' after onended fires", async () => {
    render(<ConversationMode />);
    await clickMicAndStartListening();
    await simulateFullCycleToSpeaking();
    expect(screen.getAllByText(/Speaking/).length).toBeGreaterThan(0);

    await finishTtsAndFlush();

    // Extra time to rule out lingering state
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByText("Speaking...")).not.toBeInTheDocument();
  });

  test("TTS audio error also transitions away from speaking", async () => {
    render(<ConversationMode />);
    await clickMicAndStartListening();
    await simulateFullCycleToSpeaking();
    expect(screen.getAllByText(/Speaking/).length).toBeGreaterThan(0);

    // Fire onerror instead of onended
    await act(async () => {
      capturedAudio?.onerror?.();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(400);
    });

    expect(screen.queryByText("Speaking...")).not.toBeInTheDocument();
  });

  test("TTS fetch failure skips speaking state entirely", async () => {
    // Override TTS to return 500
    (globalThis.fetch as jest.Mock).mockImplementation(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/api/audio/transcribe")) {
        return makeJsonResponse({ text: "Hello" });
      }
      if (u.includes("/api/conversation/respond")) {
        return makeSseResponse([
          { event: "token", data: "Reply" },
          { event: "done", data: { content: "Reply" } },
        ]);
      }
      if (u.includes("/api/audio/tts")) {
        return makeBlobResponse("Internal Server Error", "text/plain", 500);
      }
      return makeJsonResponse({ error: "Not found" }, 404);
    });

    render(<ConversationMode />);
    await clickMicAndStartListening();
    await simulateFullCycleToSpeaking();

    // TTS fetch failed → playTts resolves immediately → restartListening
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });

    expect(screen.queryByText("Speaking...")).not.toBeInTheDocument();
  });

  test("transition from speaking to listening completes in under 1 second", async () => {
    render(<ConversationMode />);
    await clickMicAndStartListening();
    await simulateFullCycleToSpeaking();
    expect(screen.getAllByText(/Speaking/).length).toBeGreaterThan(0);

    const start = Date.now();

    // Fire onended and advance only 400ms (300ms restartListening delay + buffer)
    await act(async () => {
      capturedAudio?.onended?.();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(400);
    });

    const elapsed = Date.now() - start;
    // Transition should complete well under 1 second of wall-clock time
    expect(elapsed).toBeLessThan(1000);
    expect(screen.getByText("Listening...")).toBeInTheDocument();
  });
});
