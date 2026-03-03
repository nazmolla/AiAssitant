/**
 * Unit tests — Audio utility (STT / TTS)
 *
 * Tests the getAudioClient, transcribeAudio, and textToSpeech functions.
 */

import type { LlmProviderRecord } from "@/lib/db/queries";

// ── Mocks ────────────────────────────────────────────────────────

const mockCreate = jest.fn();
const mockSpeechCreate = jest.fn();

jest.mock("openai", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      audio: {
        transcriptions: { create: mockCreate },
        speech: { create: mockSpeechCreate },
      },
    })),
  };
});

const MOCK_OPENAI_PROVIDER: LlmProviderRecord = {
  id: "provider-1",
  label: "Test OpenAI",
  provider_type: "openai",
  purpose: "chat",
  config_json: JSON.stringify({ apiKey: "test-key-123" }),
  is_default: 1,
  created_at: new Date().toISOString(),
};

const MOCK_AZURE_PROVIDER: LlmProviderRecord = {
  id: "provider-2",
  label: "Test Azure",
  provider_type: "azure-openai",
  purpose: "chat",
  config_json: JSON.stringify({
    apiKey: "azure-key-123",
    endpoint: "https://test.openai.azure.com",
    deployment: "gpt-4o",
  }),
  is_default: 1,
  created_at: new Date().toISOString(),
};

const MOCK_AUDIO_PROVIDER: LlmProviderRecord = {
  id: "provider-3",
  label: "Audio Provider",
  provider_type: "azure-openai",
  purpose: "audio",
  config_json: JSON.stringify({
    apiKey: "azure-key-456",
    endpoint: "https://audio.openai.azure.com",
    ttsDeployment: "my-tts",
    sttDeployment: "my-whisper",
  }),
  is_default: 0,
  created_at: new Date().toISOString(),
};

const MOCK_OPENAI_AUDIO_PROVIDER: LlmProviderRecord = {
  id: "provider-4",
  label: "OpenAI Audio",
  provider_type: "openai",
  purpose: "audio",
  config_json: JSON.stringify({ apiKey: "sk-audio-key" }),
  is_default: 0,
  created_at: new Date().toISOString(),
};

let mockProviders: LlmProviderRecord[] = [MOCK_OPENAI_PROVIDER];

jest.mock("@/lib/db", () => ({
  listLlmProviders: jest.fn(() => mockProviders),
  addLog: jest.fn(),
}));

import { getAudioClient, transcribeAudio, textToSpeech, MAX_AUDIO_SIZE_BYTES } from "@/lib/audio";

beforeEach(() => {
  jest.clearAllMocks();
  mockProviders = [MOCK_OPENAI_PROVIDER];
});

// ── Tests ────────────────────────────────────────────────────────

describe("getAudioClient", () => {
  test("creates OpenAI client from openai provider", () => {
    const client = getAudioClient();
    expect(client).toBeDefined();
    expect(client.audio).toBeDefined();
  });

  test("prefers openai over azure-openai", () => {
    mockProviders = [MOCK_AZURE_PROVIDER, MOCK_OPENAI_PROVIDER];
    const client = getAudioClient();
    expect(client).toBeDefined();
  });

  test("falls back to azure-openai when no openai provider", () => {
    mockProviders = [MOCK_AZURE_PROVIDER];
    const client = getAudioClient();
    expect(client).toBeDefined();
  });

  test("throws when no compatible provider configured", () => {
    mockProviders = [
      { ...MOCK_OPENAI_PROVIDER, provider_type: "anthropic" as LlmProviderRecord["provider_type"] },
    ];
    expect(() => getAudioClient()).toThrow(/No OpenAI-compatible/);
  });

  test("prefers providers with purpose=audio over chat providers", () => {
    mockProviders = [MOCK_OPENAI_PROVIDER, MOCK_OPENAI_AUDIO_PROVIDER];
    const OpenAI = require("openai").default;
    getAudioClient();
    // The audio-purpose provider should be chosen; check the apiKey used
    const lastCall = OpenAI.mock.calls[OpenAI.mock.calls.length - 1][0];
    expect(lastCall.apiKey).toBe("sk-audio-key");
  });

  test("falls back to chat provider when no audio provider exists", () => {
    mockProviders = [MOCK_OPENAI_PROVIDER];
    const OpenAI = require("openai").default;
    getAudioClient();
    const lastCall = OpenAI.mock.calls[OpenAI.mock.calls.length - 1][0];
    expect(lastCall.apiKey).toBe("test-key-123");
  });

  test("uses ttsDeployment for TTS on azure-openai audio provider", () => {
    mockProviders = [MOCK_AUDIO_PROVIDER];
    const OpenAI = require("openai").default;
    getAudioClient("tts");
    const lastCall = OpenAI.mock.calls[OpenAI.mock.calls.length - 1][0];
    expect(lastCall.baseURL).toContain("/my-tts");
  });

  test("uses sttDeployment for STT on azure-openai audio provider", () => {
    mockProviders = [MOCK_AUDIO_PROVIDER];
    const OpenAI = require("openai").default;
    getAudioClient("stt");
    const lastCall = OpenAI.mock.calls[OpenAI.mock.calls.length - 1][0];
    expect(lastCall.baseURL).toContain("/my-whisper");
  });

  test("uses default tts/whisper deployments when not specified", () => {
    const providerNoDeployments: LlmProviderRecord = {
      ...MOCK_AZURE_PROVIDER,
      purpose: "audio" as LlmProviderRecord["purpose"],
      config_json: JSON.stringify({
        apiKey: "azure-key-789",
        endpoint: "https://test.openai.azure.com",
      }),
    };
    mockProviders = [providerNoDeployments];
    const OpenAI = require("openai").default;
    
    getAudioClient("tts");
    let lastCall = OpenAI.mock.calls[OpenAI.mock.calls.length - 1][0];
    expect(lastCall.baseURL).toContain("/tts");
    
    getAudioClient("stt");
    lastCall = OpenAI.mock.calls[OpenAI.mock.calls.length - 1][0];
    expect(lastCall.baseURL).toContain("/whisper");
  });
});

describe("transcribeAudio", () => {
  test("sends audio to Whisper and returns text", async () => {
    mockCreate.mockResolvedValue("Hello, this is a test.");

    const buffer = Buffer.from("fake-audio-data");
    const result = await transcribeAudio(buffer, "test.webm", "audio/webm");

    expect(result).toBe("Hello, this is a test.");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "whisper-1",
        response_format: "text",
      })
    );
  });

  test("handles object response format", async () => {
    mockCreate.mockResolvedValue({ text: "Transcribed text here." });

    const buffer = Buffer.from("fake-audio-data");
    const result = await transcribeAudio(buffer, "test.webm", "audio/webm");

    expect(result).toBe("Transcribed text here.");
  });

  test("rejects audio exceeding size limit", async () => {
    const bigBuffer = Buffer.alloc(MAX_AUDIO_SIZE_BYTES + 1);
    await expect(
      transcribeAudio(bigBuffer, "big.webm", "audio/webm")
    ).rejects.toThrow(/exceeds.*limit/i);
  });
});

describe("textToSpeech", () => {
  test("sends text to TTS and returns ArrayBuffer", async () => {
    const fakeAudio = new ArrayBuffer(1024);
    mockSpeechCreate.mockResolvedValue({ arrayBuffer: () => Promise.resolve(fakeAudio) });

    const result = await textToSpeech("Hello world");

    expect(result).toBe(fakeAudio);
    expect(mockSpeechCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "tts-1",
        voice: "nova",
        input: "Hello world",
        response_format: "mp3",
      })
    );
  });

  test("uses specified voice", async () => {
    const fakeAudio = new ArrayBuffer(512);
    mockSpeechCreate.mockResolvedValue({ arrayBuffer: () => Promise.resolve(fakeAudio) });

    await textToSpeech("Test", "echo");

    expect(mockSpeechCreate).toHaveBeenCalledWith(
      expect.objectContaining({ voice: "echo" })
    );
  });

  test("truncates text exceeding max length", async () => {
    const fakeAudio = new ArrayBuffer(512);
    mockSpeechCreate.mockResolvedValue({ arrayBuffer: () => Promise.resolve(fakeAudio) });

    const longText = "x".repeat(5000);
    await textToSpeech(longText);

    const calledInput = mockSpeechCreate.mock.calls[0][0].input;
    expect(calledInput.length).toBeLessThanOrEqual(4097); // 4096 + "…"
  });

  test("rejects empty text", async () => {
    await expect(textToSpeech("")).rejects.toThrow(/empty/i);
  });
});
