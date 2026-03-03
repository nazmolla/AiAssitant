import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { transcribeAudio, MAX_AUDIO_SIZE_BYTES } from "@/lib/audio";
import { addLog } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/audio/transcribe
 *
 * Accepts audio as multipart/form-data with a single "audio" field.
 * Returns `{ text: string }` with the Whisper transcription.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof File)) {
      return NextResponse.json(
        { error: "Missing 'audio' field in form data." },
        { status: 400 }
      );
    }

    if (audioFile.size > MAX_AUDIO_SIZE_BYTES) {
      return NextResponse.json(
        { error: "Audio file exceeds 25 MB limit." },
        { status: 413 }
      );
    }

    // Validate MIME type
    const validTypes = [
      "audio/webm", "audio/mp4", "audio/mpeg", "audio/mp3",
      "audio/wav", "audio/ogg", "audio/flac", "audio/m4a",
      "video/webm", // Chrome sometimes reports webm as video/webm
    ];
    if (!validTypes.some((t) => audioFile.type.startsWith(t))) {
      return NextResponse.json(
        { error: `Unsupported audio format: ${audioFile.type}` },
        { status: 415 }
      );
    }

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const text = await transcribeAudio(buffer, audioFile.name, audioFile.type);

    addLog({
      level: "info",
      source: "audio",
      message: `Transcribed ${(audioFile.size / 1024).toFixed(0)} KB audio → ${text.length} chars`,
      metadata: JSON.stringify({ userId: auth.user.id }),
    });

    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addLog({
      level: "error",
      source: "audio",
      message: `Transcription failed: ${message}`,
      metadata: JSON.stringify({ userId: auth.user.id }),
    });
    return NextResponse.json(
      { error: "Transcription failed. Check LLM provider configuration." },
      { status: 500 }
    );
  }
}
