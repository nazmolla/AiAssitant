/**
 * Component tests — Interrupt / Barge-in
 *
 * Verifies that when the user starts speaking during "thinking" or
 * "speaking" states, the ConversationMode component interrupts the
 * current operation and transitions to "listening".
 *
 * The interrupt VAD uses a **separate** getUserMedia stream and
 * AudioContext from the main recording VAD. In these tests we
 * control it via the shared vadSignal + interruptVadSignal variables
 * and separate AudioContext mock instances.
 *
 * @jest-environment jsdom
 */
import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom";

/* ─── Framework mocks ────────────────────────────────────────────── */

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => "/conversation",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: {
      user: { email: "user@test.com", id: "user-1" },
      expires: "2099-01-01",
    },
    status: "authenticated",
  })),
  signOut: jest.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "ember",
    setTheme: jest.fn(),
    font: "inter",
    setFont: jest.fn(),
    timezone: "UTC",
    setTimezone: jest.fn(),
    formatDate: (d: string) => d,
  }),
  THEMES: [
    {
      id: "ember",
      label: "Ember",
      description: "Bold red",
      swatch: "hsl(0 85% 60%)",
    },
  ],
  FONTS: [
    {
      id: "inter",
      label: "Inter",
      description: "Default",
      preview: "'Inter', sans-serif",
    },
  ],
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

/* ─── Browser API mocks ──────────────────────────────────────────── */

/** Captured Audio instance */
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
    stop: jest.fn(),
    kind: "audio",
    enabled: true,
    id: "fake-track",
    readyState: "live",
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
    addTrack: jest.fn(),
    removeTrack: jest.fn(),
    clone: jest.fn(),
    id: "fake-stream",
    active: true,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
    onaddtrack: null,
    onremovetrack: null,
  } as unknown as MediaStream;
}

/** Mock MediaRecorder */
let capturedRecorder: {
  start: jest.Mock;
  stop: jest.Mock;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  state: string;
  mimeType: string;
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
        const fakeAudioData = new Uint8Array(256).fill(0xff);
        setTimeout(() => {
          capturedRecorder?.ondataavailable?.({
            data: new Blob([fakeAudioData], { type: "audio/webm" }),
          });
          capturedRecorder?.onstop?.();
        }, 5);
      }
    }),
    ondataavailable: null,
    onstop: null,
    state: "inactive",
    mimeType: "audio/webm",
  };
  return capturedRecorder;
});
// @ts-expect-error — static method
MediaRecorder.isTypeSupported = jest.fn().mockReturnValue(true);

/**
 * Main VAD signal:      controls the recording-time analyser.
 * Interrupt VAD signal:  controls the interrupt-time analyser.
 *
 * The component creates TWO AudioContext instances:
 *  1. During startListening() — used by the main recording VAD
 *  2. During startInterruptVad() — used by the barge-in detector
 *
 * We track them via audioContextCount so we can give each its own
 * analyser behaviour.
 */
let vadSignal: "speech" | "silence" = "silence";
let interruptVadSignal: "speech" | "silence" = "silence";
let audioContextCount = 0;

// @ts-expect-error — replacing global AudioContext
globalThis.AudioContext = jest.fn().mockImplementation(() => {
  audioContextCount++;
  const ctxIndex = audioContextCount;

  return {
    createMediaStreamSource: jest
      .fn()
      .mockReturnValue({ connect: jest.fn(), disconnect: jest.fn() }),
    createAnalyser: jest.fn().mockReturnValue({
      fftSize: 2048,
      getFloatTimeDomainData: jest
        .fn()
        .mockImplementation((dataArray: Float32Array) => {
          // Odd-numbered contexts are main VAD, even-numbered are interrupt VAD
          // Context 1 = main recording VAD (startListening)
          // Context 2 = interrupt VAD (startInterruptVad)
          // Context 3 = main recording VAD after interrupt restart
          const signal =
            ctxIndex % 2 === 1 ? vadSignal : interruptVadSignal;
          const value = signal === "speech" ? 0.5 : 0.001;
          for (let i = 0; i < dataArray.length; i++) dataArray[i] = value;
        }),
      connect: jest.fn(),
      disconnect: jest.fn(),
    }),
    close: jest.fn().mockResolvedValue(undefined),
    state: "running",
  };
});

/* ─── SSE / fetch helpers ────────────────────────────────────────── */

function buildSSE(
  events: Array<{ event: string; data: unknown }>
): string {
  return events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join("");
}

function makeSseResponse(
  events: Array<{ event: string; data: unknown }>
) {
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

/**
 * A slow SSE response. The reader yields one token per read, with a small
 * delay between reads, so interrupt VAD has time to fire.
 */
function makeSlowSseResponse(
  tokens: string[],
  delayMs = 50
) {
  let idx = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (idx < tokens.length) {
            const token = tokens[idx++];
            const text = `event: token\ndata: ${JSON.stringify(token)}\n\n`;
            // Simulate network delay
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return {
              value: new TextEncoder().encode(text),
              done: false,
            };
          }
          // Send done event
          if (idx === tokens.length) {
            idx++;
            const fullContent = tokens.join("");
            const text = `event: done\ndata: ${JSON.stringify({ content: fullContent })}\n\n`;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return {
              value: new TextEncoder().encode(text),
              done: false,
            };
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

function makeBlobResponse(
  content: string,
  type = "audio/mpeg",
  status = 200
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: async () => new Blob([content], { type }),
  };
}

/** Standard fast fetch mock */
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

/** Slow-LLM fetch mock — SSE tokens arrive slowly enough for interrupt to trigger */
function setupSlowLlmFetchMock() {
  globalThis.fetch = jest.fn().mockImplementation(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("/api/audio/transcribe")) {
      return makeJsonResponse({ text: "Hello Nexus" });
    }
    if (u.includes("/api/conversation/respond")) {
      return makeSlowSseResponse([
        "This ",
        "is ",
        "a ",
        "long ",
        "response ",
        "that ",
        "takes ",
        "a ",
        "while...",
      ], 100);
    }
    if (u.includes("/api/audio/tts")) {
      return makeBlobResponse("fake-tts");
    }
    return makeJsonResponse({ error: "Not found" }, 404);
  }) as jest.Mock;
}

const mockGetUserMedia = jest.fn().mockResolvedValue(createFakeMediaStream());
Object.defineProperty(navigator, "mediaDevices", {
  value: { getUserMedia: mockGetUserMedia },
  configurable: true,
  writable: true,
});
globalThis.URL.createObjectURL = jest
  .fn()
  .mockReturnValue("blob:fake-url");
globalThis.URL.revokeObjectURL = jest.fn();

afterEach(() => {
  cleanup();
  capturedAudio = null;
  capturedRecorder = null;
  vadSignal = "silence";
  interruptVadSignal = "silence";
  audioContextCount = 0;
});

import { ConversationMode } from "@/components/conversation-mode";

/* ═══════════════════════════════════════════════════════════════════ */
/*  Helpers                                                          */
/* ═══════════════════════════════════════════════════════════════════ */

/** Click the mic button and flush startListening */
async function clickMicAndStartListening() {
  const micButton = screen.getByTestId("MicIcon").closest("button")!;
  await act(async () => {
    fireEvent.click(micButton);
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

/**
 * Simulate VAD cycle → STT → LLM → entering "speaking" state.
 * Returns with component in "speaking" state and capturedAudio ready.
 */
async function simulateFullCycleToSpeaking() {
  // Speech for 600ms (> MIN_SPEECH_DURATION_MS = 400ms)
  vadSignal = "speech";
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });

  // Silence for 1400ms (> SILENCE_DURATION_MS = 1200ms)
  vadSignal = "silence";
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1400);
  });

  // Flush through processAudio pipeline
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
  }
}

/**
 * Simulate VAD cycle → STT → entering "thinking" state.
 * Uses a slow LLM mock so the state stays in "thinking" long enough
 * for the interrupt VAD to detect speech.
 */
async function simulateCycleToThinking() {
  // Speech for 600ms
  vadSignal = "speech";
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });

  // Silence for 1400ms → triggers stopRecordingForProcessing
  vadSignal = "silence";
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1400);
  });

  // Flush recorder.stop setTimeout (5ms) + STT fetch → enters "thinking" state
  // We flush just enough for STT to resolve and state to hit "thinking"
  // but NOT enough for the slow LLM stream to finish
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
  }
}

/**
 * Start interrupt speech: set the interrupt VAD signal to speech
 * and advance enough time for 200ms sustained speech detection.
 */
async function triggerInterruptSpeech() {
  interruptVadSignal = "speech";
  // Advance 350ms — polling at 100ms intervals, need 200ms cumulative
  // so we need at least 3 polls: t=100, t=200, t=300
  await act(async () => {
    await jest.advanceTimersByTimeAsync(350);
  });
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  Tests                                                            */
/* ═══════════════════════════════════════════════════════════════════ */

describe("ConversationMode — Interrupt / Barge-in", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetUserMedia.mockResolvedValue(createFakeMediaStream());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("interrupt during speaking → stops TTS and transitions to listening", async () => {
    setupFetchMock();
    render(<ConversationMode />);

    await clickMicAndStartListening();
    await simulateFullCycleToSpeaking();
    expect(screen.getAllByText(/Speaking/).length).toBeGreaterThan(0);

    // Simulate user speaking to interrupt
    await triggerInterruptSpeech();

    // Flush startListening after interrupt (150ms delay)
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });

    // TTS should be paused
    expect(capturedAudio?.pause).toHaveBeenCalled();

    // Should be listening now
    expect(screen.getByText("Listening...")).toBeInTheDocument();
    expect(screen.queryByText("Speaking...")).not.toBeInTheDocument();
  });

  test("interrupt during thinking → aborts LLM and transitions to listening", async () => {
    setupSlowLlmFetchMock();
    render(<ConversationMode />);

    await clickMicAndStartListening();
    await simulateCycleToThinking();

    // Simulate user speaking to interrupt during thinking
    await triggerInterruptSpeech();

    // Flush listening restart
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });

    // Should transition to listening
    expect(screen.getByText("Listening...")).toBeInTheDocument();
    expect(screen.queryByText(/Thinking/)).not.toBeInTheDocument();
  });

  test("interrupted assistant response is marked with ⸺", async () => {
    setupFetchMock();
    render(<ConversationMode />);

    await clickMicAndStartListening();
    await simulateFullCycleToSpeaking();

    // We should have the assistant text in the transcript area
    // Now interrupt
    await triggerInterruptSpeech();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });

    // The transcript should contain the "⸺" marker
    const transcriptArea = document.querySelector('[class*="transcript"]') ||
      document.body;
    const allText = transcriptArea.textContent || "";
    // The interrupted text should have the ⸺ marker
    expect(allText).toContain("⸺");
  });

  test("no interrupt during idle/listening/processing states", async () => {
    setupFetchMock();
    render(<ConversationMode />);

    // In idle state — interrupt signal should do nothing
    interruptVadSignal = "speech";
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText("Ready to talk")).toBeInTheDocument();

    // Start listening — interrupt signal should also do nothing
    await clickMicAndStartListening();
    expect(screen.getByText("Listening...")).toBeInTheDocument();

    interruptVadSignal = "speech";
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    // Should still be listening (no interrupt during listening)
    expect(screen.getByText("Listening...")).toBeInTheDocument();
  });

  test("hint text shows 'Start speaking to interrupt' during thinking/speaking", async () => {
    setupFetchMock();
    render(<ConversationMode />);

    await clickMicAndStartListening();
    await simulateFullCycleToSpeaking();
    expect(screen.getAllByText(/Speaking/).length).toBeGreaterThan(0);

    // Hint text should show interrupt prompt
    expect(
      screen.getByText("Start speaking to interrupt")
    ).toBeInTheDocument();
  });

  test("stopEverything cleans up interrupt VAD", async () => {
    setupSlowLlmFetchMock();
    render(<ConversationMode />);

    await clickMicAndStartListening();
    await simulateCycleToThinking();

    // Advance a bit so interrupt VAD starts
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50);
    });

    // Click stop button (StopCircleIcon is rendered when active)
    const stopButton = screen.getByTestId("StopCircleIcon")?.closest("button");
    if (stopButton) {
      await act(async () => {
        fireEvent.click(stopButton!);
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(100);
      });
    }

    // After stop, should be idle — no crash
    // The important thing is no unhandled timer errors
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText("Ready to talk")).toBeInTheDocument();
  });

  test("interrupt does not trigger from brief noise (< 200ms)", async () => {
    setupFetchMock();
    render(<ConversationMode />);

    await clickMicAndStartListening();
    await simulateFullCycleToSpeaking();
    expect(screen.getAllByText(/Speaking/).length).toBeGreaterThan(0);

    // Brief speech — NOT enough for 200ms
    interruptVadSignal = "speech";
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100); // Only 100ms — one poll
    });
    interruptVadSignal = "silence";
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });

    // Should still be speaking (interrupt NOT triggered)
    expect(screen.getAllByText(/Speaking/).length).toBeGreaterThan(0);
  });

  test("after interrupt, user can complete a new full conversation cycle", async () => {
    setupFetchMock();
    render(<ConversationMode />);

    // First cycle → speaking
    await clickMicAndStartListening();
    await simulateFullCycleToSpeaking();
    expect(screen.getAllByText(/Speaking/).length).toBeGreaterThan(0);

    // Interrupt
    await triggerInterruptSpeech();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByText("Listening...")).toBeInTheDocument();

    // Second cycle — should work normally
    // Re-setup fast fetch since the old one is fine
    setupFetchMock();

    // Speech → silence → processing → thinking → speaking
    vadSignal = "speech";
    await act(async () => {
      await jest.advanceTimersByTimeAsync(600);
    });
    vadSignal = "silence";
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1400);
    });
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10);
      });
    }

    // Should reach speaking again — full cycle works after interrupt
    expect(screen.getAllByText(/Speaking/).length).toBeGreaterThan(0);

    // Now let TTS finish normally
    await act(async () => {
      capturedAudio?.onended?.();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(400);
    });
    expect(screen.getByText("Listening...")).toBeInTheDocument();
  });
});
