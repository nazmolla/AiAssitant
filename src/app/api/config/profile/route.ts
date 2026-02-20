import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getUserProfile, upsertUserProfile } from "@/lib/db";

export async function GET() {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;

    const profile = getUserProfile(auth.user.id);
    return NextResponse.json(profile ?? null);
  } catch (e: any) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;

    const body = await req.json();
    // Whitelist allowed profile fields to prevent mass assignment
    const ALLOWED_FIELDS = [
      "display_name", "title", "bio", "location", "phone",
      "email", "website", "linkedin", "github", "twitter",
      "skills", "languages", "company",
    ] as const;
    const sanitized: Record<string, unknown> = {};
    for (const key of ALLOWED_FIELDS) {
      if (body[key] !== undefined) sanitized[key] = body[key];
    }
    const updated = upsertUserProfile(auth.user.id, sanitized);
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
