/**
 * Audio utilities — Speech-to-Text (Whisper) and Text-to-Speech.
 *
 * Prefers LLM providers configured with `purpose = "audio"`.  Falls back to
 * the first OpenAI-compatible provider (OpenAI, Azure OpenAI, or LiteLLM).
 * Anthropic is skipped since it doesn't offer audio APIs.
 *
 * Azure OpenAI requires **separate deployments** for TTS and STT because
 * the deployment name is part of the REST URL.  Audio-purpose providers
 * store `ttsDeployment` and `sttDeployment` in their config.  When falling
 * back to a chat provider, these default to "tts" and "whisper".
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
const DEFAULT_TTS_DEPLOYMENT = "tts";
const DEFAULT_STT_DEPLOYMENT = "whisper";
const MAX_AUDIO_SIZE_MB = 25; // OpenAI Whisper limit
export const MAX_AUDIO_SIZE_BYTES = MAX_AUDIO_SIZE_MB * 1024 * 1024;
const MAX_TTS_TEXT_LENGTH = 4096;

/**
 * Find the best provider for audio operations and return an OpenAI client.
 *
 * 1. First looks for providers with `purpose = "audio"` (preferred).
 * 2. Falls back to any OpenAI-compatible provider (openai > azure-openai > litellm).
 *
 * For Azure OpenAI the deployment name is embedded in the base URL, so TTS
 * and STT each need their own deployment.  Audio-purpose providers store
 * `ttsDeployment` / `sttDeployment` in their config; for fallback chat
 * providers these default to "tts" / "whisper".
 *
 * Throws if no compatible provider is configured.
 */
export function getAudioClient(operation: AudioOperation = "tts"): OpenAI {
  const providers = listLlmProviders();

  const audioCompatible = ["openai", "azure-openai", "litellm"];

  // 1. Prefer providers with purpose = 'audio'
  let chosen: LlmProviderRecord | undefined;
  for (const type of audioCompatible) {
    chosen = providers.find((p) => p.provider_type === type && p.purpose === "audio");
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

  if (chosen.provider_type === "azure-openai") {
    const endpoint = (config.endpoint as string).replace(/\/$/, "");

    // Pick the right deployment for TTS vs STT
    const deployment = operation === "tts"
      ? (config.ttsDeployment as string) || DEFAULT_TTS_DEPLOYMENT
      : (config.sttDeployment as string) || DEFAULT_STT_DEPLOYMENT;

    return new OpenAI({
      apiKey: config.apiKey as string,
      baseURL: `${endpoint}/openai/deployments/${deployment}`,
      defaultQuery: { "api-version": (config.apiVersion as string) || "2024-08-01-preview" },
      defaultHeaders: { "api-key": config.apiKey as string },
    });
  }

  // OpenAI or LiteLLM
  return new OpenAI({
    apiKey: config.apiKey as string,
    baseURL: config.baseURL as string | undefined,
  });
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

  const client = getAudioClient("stt");

  // Create a File-like object from the buffer
  const uint8 = new Uint8Array(audioBuffer);
  const file = new File([uint8], filename, { type: mimeType });

  const result = await client.audio.transcriptions.create({
    model: DEFAULT_STT_MODEL,
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

  const client = getAudioClient("tts");

  const response = await client.audio.speech.create({
    model: DEFAULT_TTS_MODEL,
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
