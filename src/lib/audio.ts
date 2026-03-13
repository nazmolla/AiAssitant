/**
 * Audio utilities — Speech-to-Text (Whisper) and Text-to-Speech.
 *
 * Prefers LLM providers configured with `purpose = "tts"` or `purpose = "stt"`.
 * Falls back to the first OpenAI-compatible provider (OpenAI, Azure OpenAI, or
 * LiteLLM).  Anthropic is skipped since it doesn't offer audio APIs.
 *
 * With separate TTS/STT purposes each provider uses the standard `deployment`
 * field — no special audio-specific fields needed.
 *
 * Local Whisper: When configured via app_config, a local Whisper server
 * (e.g. faster-whisper-server or whisper.cpp) is used as a fallback if the
 * cloud provider fails.  Set `whisper_local_url` (e.g. http://localhost:8083)
 * and `whisper_local_enabled` = "true" in app_config.
 */

import OpenAI from "openai";
import { listLlmProviders, getAppConfig, type LlmProviderRecord } from "@/lib/db";
import {
  AUDIO_DEFAULT_TTS_VOICE,
  AUDIO_DEFAULT_TTS_MODEL,
  AUDIO_DEFAULT_STT_MODEL,
  AUDIO_MAX_SIZE_MB,
  AUDIO_MAX_SIZE_BYTES,
  AUDIO_MAX_TTS_TEXT_LENGTH,
  AUDIO_OPERATION_TIMEOUT_MS,
} from "@/lib/constants";

/** Supported TTS voices */
export type TtsVoice = "alloy" | "ash" | "coral" | "echo" | "fable" | "onyx" | "nova" | "sage" | "shimmer";

/** Supported TTS output formats */
export type TtsFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

/** Which audio operation the client will be used for */
export type AudioOperation = "tts" | "stt";

// Re-export for backward compatibility
export const MAX_AUDIO_SIZE_BYTES = AUDIO_MAX_SIZE_BYTES;

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
  const defaultModel = operation === "tts" ? AUDIO_DEFAULT_TTS_MODEL : AUDIO_DEFAULT_STT_MODEL;
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
 * Falls back to local Whisper server if cloud transcription fails and
 * local Whisper is configured.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  if (audioBuffer.length > MAX_AUDIO_SIZE_BYTES) {
    throw new Error(`Audio file exceeds ${AUDIO_MAX_SIZE_MB}MB limit.`);
  }

  let cloudError: Error | undefined;

  // 1. Try cloud provider first
  try {
    const { client, model } = getAudioClient("stt");
    const uint8 = new Uint8Array(audioBuffer);
    const file = new File([uint8], filename, { type: mimeType });

    const result = await client.audio.transcriptions.create({
      model,
      file,
      response_format: "text",
    });

    return typeof result === "string" ? result : (result as unknown as { text: string }).text;
  } catch (err) {
    cloudError = err instanceof Error ? err : new Error(String(err));
  }

  // 2. Fall back to local Whisper if configured
  const localConfig = getLocalWhisperConfig();
  if (localConfig.enabled && localConfig.url) {
    try {
      return await transcribeAudioLocal(audioBuffer, filename, mimeType, localConfig);
    } catch (localErr) {
      const localMessage = localErr instanceof Error ? localErr.message : String(localErr);
      throw new Error(
        `Cloud STT failed: ${cloudError?.message}. Local Whisper also failed: ${localMessage}`
      );
    }
  }

  // No local fallback configured — throw the cloud error
  throw cloudError ?? new Error("No STT provider configured.");
}

/* -------------------------------------------------------------------------- */
/*  Local Whisper fallback                                                      */
/* -------------------------------------------------------------------------- */

export interface LocalWhisperConfig {
  enabled: boolean;
  url: string;
  model: string;
}

/**
 * Read local Whisper configuration from app_config.
 * Keys: whisper_local_enabled, whisper_local_url, whisper_local_model
 */
export function getLocalWhisperConfig(): LocalWhisperConfig {
  const enabled = getAppConfig("whisper_local_enabled") === "true";
  const url = getAppConfig("whisper_local_url") || "";
  const model = getAppConfig("whisper_local_model") || "whisper-1";
  return { enabled, url, model };
}

/**
 * Transcribe audio using a local Whisper server.
 * Supports OpenAI-compatible `/v1/audio/transcriptions` endpoint
 * (e.g. faster-whisper-server, whisper.cpp server).
 */
async function transcribeAudioLocal(
  audioBuffer: Buffer,
  filename: string,
  mimeType: string,
  config: LocalWhisperConfig
): Promise<string> {
  const baseUrl = config.url.replace(/\/$/, "");

  // Block cloud metadata endpoints from being used as Whisper URL
  try {
    const parsed = new URL(baseUrl);
    const blockedHosts = ['169.254.169.254', 'metadata.google.internal', 'metadata.azure.com'];
    if (blockedHosts.includes(parsed.hostname)) {
      throw new Error("Local Whisper URL points to a blocked metadata endpoint.");
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('blocked')) throw e;
    throw new Error(`Invalid local Whisper URL: ${baseUrl}`);
  }

  const endpoint = `${baseUrl}/v1/audio/transcriptions`;
  const endpointFallback = `${baseUrl}/inference`;

  // Build multipart form data
  const formData = new FormData();
  const uint8 = new Uint8Array(audioBuffer);
  const file = new File([uint8], filename, { type: mimeType });
  formData.append("file", file);
  formData.append("model", config.model);
  formData.append("response_format", "json");

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(AUDIO_OPERATION_TIMEOUT_MS),
    });
  } catch {
    // If the OAI-compatible endpoint fails, try the whisper.cpp /inference endpoint
    const fallbackForm = new FormData();
    fallbackForm.append("file", file);
    fallbackForm.append("response_format", "json");
    response = await fetch(endpointFallback, {
      method: "POST",
      body: fallbackForm,
      signal: AbortSignal.timeout(AUDIO_OPERATION_TIMEOUT_MS),
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Local Whisper returned ${response.status}: ${body}`);
  }

  const result = await response.json();
  return typeof result === "string" ? result : (result as { text: string }).text;
}

/** Map TTS format to MIME type */
export function ttsFormatToMime(format: TtsFormat): string {
  switch (format) {
    case "mp3": return "audio/mpeg";
    case "opus": return "audio/opus";
    case "aac": return "audio/aac";
    case "flac": return "audio/flac";
    case "wav": return "audio/wav";
    case "pcm": return "audio/L16;rate=24000;channels=1";
    default: return "audio/mpeg";
  }
}

/**
 * Convert text to speech using OpenAI TTS.
 * Returns an ArrayBuffer of audio data in the requested format.
 *
 * @param format Output format (default "mp3"). "wav" is useful for
 *   embedded devices that can't decode MP3.  "pcm" returns raw 16-bit
 *   signed LE samples at 24 kHz.
 */
export async function textToSpeech(
  text: string,
  voice: TtsVoice = AUDIO_DEFAULT_TTS_VOICE,
  format: TtsFormat = "mp3"
): Promise<ArrayBuffer> {
  if (!text || text.length === 0) {
    throw new Error("Text is empty.");
  }

  // Truncate to max length
  const truncated = text.length > AUDIO_MAX_TTS_TEXT_LENGTH
    ? text.slice(0, AUDIO_MAX_TTS_TEXT_LENGTH) + "…"
    : text;

  const { client, model } = getAudioClient("tts");

  const response = await client.audio.speech.create({
    model,
    voice,
    input: truncated,
    response_format: format,
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
