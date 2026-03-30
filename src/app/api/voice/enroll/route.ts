import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { enrollVoice, removeVoiceProfile } from "@/lib/voice-id";
import { getVoiceProfile } from "@/lib/db/voice-profile-queries";

/**
 * GET /api/voice/enroll
 * Returns enrollment status for the authenticated user.
 */
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const profile = getVoiceProfile(auth.user.id);
  return NextResponse.json({
    enrolled: !!profile,
    enrolledAt: profile?.enrolled_at ?? null,
  });
}

/**
 * POST /api/voice/enroll
 * Enroll a voice profile from a WAV audio recording.
 * Body: multipart/form-data with "audio" field (WAV file, min ~5s recommended).
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const audioField = formData.get("audio");
  if (!audioField || !(audioField instanceof Blob)) {
    return NextResponse.json({ error: "Missing audio field" }, { status: 400 });
  }

  const maxBytes = 10 * 1024 * 1024; // 10 MB
  if (audioField.size > maxBytes) {
    return NextResponse.json({ error: "Audio file too large (max 10 MB)" }, { status: 413 });
  }

  const audioBuffer = Buffer.from(await audioField.arrayBuffer());

  try {
    await enrollVoice(auth.user.id, audioBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  return NextResponse.json({ enrolled: true });
}

/**
 * DELETE /api/voice/enroll
 * Remove the authenticated user's voice profile.
 */
export async function DELETE() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  removeVoiceProfile(auth.user.id);
  return new NextResponse(null, { status: 204 });
}
