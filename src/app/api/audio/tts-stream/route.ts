import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { textToSpeech, type TtsVoice } from "@/lib/audio";
import { addLog } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_VOICES = [
  "alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer",
] as const;
const VALID_VOICES_SET = new Set<string>(VALID_VOICES);

/**
 * POST /api/audio/tts-stream
 *
 * Converts text chunks to speech for audio mode.
 * Accepts JSON `{ text: string, voice?: TtsVoice }`.
 * Returns MP3 audio as a binary stream with Transfer-Encoding: chunked.
 *
 * This is the same as /api/audio/tts but with streaming-friendly headers
 * so the client can start playback before the full response is ready.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const { text, voice } = body as { text?: string; voice?: string };

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing or empty 'text' field." },
        { status: 400 }
      );
    }

    if (voice && !VALID_VOICES_SET.has(voice)) {
      return NextResponse.json(
        { error: `Invalid voice. Valid voices: ${VALID_VOICES.join(", ")}` },
        { status: 400 }
      );
    }

    const audioBuffer = await textToSpeech(text.trim(), (voice as TtsVoice) || undefined);

    addLog({
      level: "info",
      source: "audio",
      message: `TTS-stream generated: ${text.length} chars → ${(audioBuffer.byteLength / 1024).toFixed(0)} KB audio`,
      metadata: JSON.stringify({ userId: auth.user.id, voice: voice || "nova" }),
    });

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.byteLength),
        "Cache-Control": "no-cache, no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addLog({
      level: "error",
      source: "audio",
      message: `TTS-stream failed: ${message}`,
      metadata: JSON.stringify({ userId: auth.user.id }),
    });
    return NextResponse.json(
      { error: "Text-to-speech failed. Check LLM provider configuration." },
      { status: 500 }
    );
  }
}
