/**
 * Audio utilities — Speech-to-Text (Whisper) and Text-to-Speech.
 *
 * Prefers LLM providers configured with `purpose = "tts"` or `purpose = "stt"`.
 * Falls back to the first OpenAI-compatible provider (OpenAI, Azure OpenAI, or
 * LiteLLM).  Anthropic is skipped since it doesn't offer audio APIs.
 *
 * With separate TTS/STT purposes each provider uses the standard `deployment`
 * field — no special audio-specific fields needed.
 */

import OpenAI from "openai";
import { listLlmProviders, type LlmProviderRecord } from "@/lib/db";

/** Supported TTS voices */
export type TtsVoice = "alloy" | "ash" | "coral" | "echo" | "fable" | "onyx" | "nova" | "sage" | "shimmer";

/** Which audio operation the client will be used for */
export type AudioOperation = "tts" | "stt";

const DEFAULT_TTS_VOICE: TtsVoice = "nova";
const DEFAULT_TTS_MODEL = "tts-1";
const DEFAULT_STT_MODEL = "whisper-1";
const MAX_AUDIO_SIZE_MB = 25; // OpenAI Whisper limit
export const MAX_AUDIO_SIZE_BYTES = MAX_AUDIO_SIZE_MB * 1024 * 1024;
const MAX_TTS_TEXT_LENGTH = 4096;

/** Result from getAudioClient — client + resolved model name */
export interface AudioClientResult {
  client: OpenAI;
  model: string;
}

/**
 * Find the best provider for the given audio operation and return an OpenAI
 * client along with the resolved model name.
 *
 * 1. Looks for providers with `purpose = "tts"` (or `"stt"`).
 * 2. Falls back to any OpenAI-compatible provider (openai > azure-openai > litellm).
 *
 * For Azure OpenAI the standard `deployment` field is used in the base URL.
 * The provider config can include a `model` field to override the default
 * model name sent in API requests.
 *
 * Throws if no compatible provider is configured.
 */
export function getAudioClient(operation: AudioOperation = "tts"): AudioClientResult {
  const providers = listLlmProviders();

  const audioCompatible = ["openai", "azure-openai", "litellm"];
  const targetPurpose = operation; // "tts" or "stt"

  // 1. Prefer providers with matching purpose
  let chosen: LlmProviderRecord | undefined;
  for (const type of audioCompatible) {
    chosen = providers.find((p) => p.provider_type === type && p.purpose === targetPurpose);
    if (chosen) break;
  }

  // 2. Fall back to any compatible provider (backward-compatible)
  if (!chosen) {
    for (const type of audioCompatible) {
      chosen = providers.find((p) => p.provider_type === type);
      if (chosen) break;
    }
  }

  if (!chosen) {
    throw new Error(
      "No OpenAI-compatible LLM provider configured. Audio features require an OpenAI, Azure OpenAI, or LiteLLM provider."
    );
  }

  const config = parseConfig(chosen);

  // Resolve model name — provider config can override defaults
  const defaultModel = operation === "tts" ? DEFAULT_TTS_MODEL : DEFAULT_STT_MODEL;
  const model = (config.model as string) || defaultModel;

  if (chosen.provider_type === "azure-openai") {
    const endpoint = (config.endpoint as string).replace(/\/$/, "");
    const deployment = (config.deployment as string) || model;

    return {
      client: new OpenAI({
        apiKey: config.apiKey as string,
        baseURL: `${endpoint}/openai/deployments/${deployment}`,
        defaultQuery: { "api-version": (config.apiVersion as string) || "2024-08-01-preview" },
        defaultHeaders: { "api-key": config.apiKey as string },
      }),
      model,
    };
  }

  // OpenAI or LiteLLM
  return {
    client: new OpenAI({
      apiKey: config.apiKey as string,
      baseURL: config.baseURL as string | undefined,
    }),
    model,
  };
}

/**
 * Transcribe audio to text using OpenAI Whisper.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  if (audioBuffer.length > MAX_AUDIO_SIZE_BYTES) {
    throw new Error(`Audio file exceeds ${MAX_AUDIO_SIZE_MB}MB limit.`);
  }

  const { client, model } = getAudioClient("stt");

  // Create a File-like object from the buffer
  const uint8 = new Uint8Array(audioBuffer);
  const file = new File([uint8], filename, { type: mimeType });

  const result = await client.audio.transcriptions.create({
    model,
    file,
    response_format: "text",
  });

  return typeof result === "string" ? result : (result as unknown as { text: string }).text;
}

/**
 * Convert text to speech using OpenAI TTS.
 * Returns an ArrayBuffer of mp3 audio data.
 */
export async function textToSpeech(
  text: string,
  voice: TtsVoice = DEFAULT_TTS_VOICE
): Promise<ArrayBuffer> {
  if (!text || text.length === 0) {
    throw new Error("Text is empty.");
  }

  // Truncate to max length
  const truncated = text.length > MAX_TTS_TEXT_LENGTH
    ? text.slice(0, MAX_TTS_TEXT_LENGTH) + "…"
    : text;

  const { client, model } = getAudioClient("tts");

  const response = await client.audio.speech.create({
    model,
    voice,
    input: truncated,
    response_format: "mp3",
  });

  return response.arrayBuffer();
}

function parseConfig(record: LlmProviderRecord): Record<string, unknown> {
  try {
    return record.config_json ? JSON.parse(record.config_json) : {};
  } catch {
    return {};
  }
}
