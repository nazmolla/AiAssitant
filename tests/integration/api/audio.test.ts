/**
 * Integration tests — Audio API routes
 *
 * Tests /api/audio/transcribe and /api/audio/tts endpoints.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

// Mock the audio module so we don't call real OpenAI APIs
jest.mock("@/lib/audio", () => ({
  transcribeAudio: jest.fn(async () => "Hello from Whisper"),
  textToSpeech: jest.fn(async () => new ArrayBuffer(512)),
  ttsFormatToMime: jest.fn((fmt: string) => {
    const map: Record<string, string> = {
      mp3: "audio/mpeg",
      wav: "audio/wav",
      pcm: "audio/L16;rate=24000;channels=1",
      opus: "audio/opus",
      aac: "audio/aac",
      flac: "audio/flac",
    };
    return map[fmt] || "audio/mpeg";
  }),
  MAX_AUDIO_SIZE_BYTES: 25 * 1024 * 1024,
}));

jest.mock("@/lib/db", () => ({
  addLog: jest.fn(),
}));

import { POST as transcribePost } from "@/app/api/audio/transcribe/route";
import { POST as ttsPost } from "@/app/api/audio/tts/route";
import { NextRequest } from "next/server";

const TEST_USER = {
  id: "user-audio-1",
  email: "audio@test.com",
  role: "user" as const,
  displayName: "Audio Tester",
};

function makeFormDataRequest(file: File): NextRequest {
  const formData = new FormData();
  formData.append("audio", file);
  return new NextRequest("http://localhost/api/audio/transcribe", {
    method: "POST",
    body: formData,
  });
}

function makeJsonRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Transcribe Tests ─────────────────────────────────────────────

describe("POST /api/audio/transcribe", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const file = new File([new Uint8Array(100)], "test.webm", { type: "audio/webm" });
    const res = await transcribePost(makeFormDataRequest(file));
    expect(res.status).toBe(401);
  });

  test("returns transcribed text for valid audio", async () => {
    setMockUser(TEST_USER);
    const file = new File([new Uint8Array(1000)], "recording.webm", { type: "audio/webm" });
    const res = await transcribePost(makeFormDataRequest(file));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.text).toBe("Hello from Whisper");
  });

  test("returns 400 when no audio field", async () => {
    setMockUser(TEST_USER);
    const formData = new FormData();
    formData.append("wrong", "value");
    const req = new NextRequest("http://localhost/api/audio/transcribe", {
      method: "POST",
      body: formData,
    });
    const res = await transcribePost(req);
    expect(res.status).toBe(400);
  });

  test("returns 415 for unsupported audio format", async () => {
    setMockUser(TEST_USER);
    const file = new File([new Uint8Array(100)], "test.txt", { type: "text/plain" });
    const res = await transcribePost(makeFormDataRequest(file));
    expect(res.status).toBe(415);
  });
});

// ── TTS Tests ────────────────────────────────────────────────────

describe("POST /api/audio/tts", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const req = makeJsonRequest("http://localhost/api/audio/tts", { text: "Hello" });
    const res = await ttsPost(req);
    expect(res.status).toBe(401);
  });

  test("returns MP3 audio for valid text", async () => {
    setMockUser(TEST_USER);
    const req = makeJsonRequest("http://localhost/api/audio/tts", { text: "Hello world" });
    const res = await ttsPost(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(512);
  });

  test("returns 400 for empty text", async () => {
    setMockUser(TEST_USER);
    const req = makeJsonRequest("http://localhost/api/audio/tts", { text: "" });
    const res = await ttsPost(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 for missing text", async () => {
    setMockUser(TEST_USER);
    const req = makeJsonRequest("http://localhost/api/audio/tts", {});
    const res = await ttsPost(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid voice", async () => {
    setMockUser(TEST_USER);
    const req = makeJsonRequest("http://localhost/api/audio/tts", {
      text: "Hello",
      voice: "invalid-voice",
    });
    const res = await ttsPost(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/invalid voice/i);
  });

  test("returns WAV content-type when format=wav", async () => {
    setMockUser(TEST_USER);
    const req = makeJsonRequest("http://localhost/api/audio/tts", {
      text: "Hello",
      format: "wav",
    });
    const res = await ttsPost(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/wav");
  });

  test("returns 400 for invalid format", async () => {
    setMockUser(TEST_USER);
    const req = makeJsonRequest("http://localhost/api/audio/tts", {
      text: "Hello",
      format: "avi",
    });
    const res = await ttsPost(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/invalid format/i);
  });

  test("accepts valid voice parameter", async () => {
    setMockUser(TEST_USER);
    const req = makeJsonRequest("http://localhost/api/audio/tts", {
      text: "Hello",
      voice: "echo",
    });
    const res = await ttsPost(req);
    expect(res.status).toBe(200);
  });
});
