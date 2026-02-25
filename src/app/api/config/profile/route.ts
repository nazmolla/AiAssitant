import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getUserProfile, upsertUserProfile } from "@/lib/db";

// Maximum lengths for profile fields (defence-in-depth)
const MAX_FIELD_LEN = 500;
const MAX_BIO_LEN = 2000;

function sanitizeField(value: unknown, maxLen: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return String(value).slice(0, maxLen);
  return value.slice(0, maxLen);
}

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
      "skills", "languages", "company", "screen_sharing_enabled",
      "theme", "timezone",
    ] as const;
    const sanitized: Record<string, unknown> = {};
    for (const key of ALLOWED_FIELDS) {
      if (body[key] !== undefined) {
        const maxLen = key === "bio" ? MAX_BIO_LEN : MAX_FIELD_LEN;
        sanitized[key] = key === "screen_sharing_enabled"
          ? (body[key] ? 1 : 0)
          : sanitizeField(body[key], maxLen);
      }
    }
    const updated = upsertUserProfile(auth.user.id, sanitized);
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
