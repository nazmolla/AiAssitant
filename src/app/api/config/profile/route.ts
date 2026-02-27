import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getUserProfile, upsertUserProfile, addLog } from "@/lib/db";

// Maximum lengths for profile fields (defence-in-depth)
const MAX_FIELD_LEN = 500;
const MAX_BIO_LEN = 2000;
const NOTIFICATION_LEVELS = new Set(["low", "medium", "high", "disaster"]);

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
    addLog({
      level: "verbose",
      source: "api.config.profile",
      message: "Fetched profile configuration.",
      metadata: JSON.stringify({ userId: auth.user.id, exists: !!profile }),
    });
    return NextResponse.json(profile ?? null);
  } catch (e: any) {
    addLog({
      level: "error",
      source: "api.config.profile",
      message: "Failed to fetch profile configuration.",
      metadata: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
    });
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
      "notification_level", "theme", "font", "timezone",
    ] as const;
    const sanitized: Record<string, unknown> = {};
    for (const key of ALLOWED_FIELDS) {
      if (body[key] !== undefined) {
        const maxLen = key === "bio" ? MAX_BIO_LEN : MAX_FIELD_LEN;
        sanitized[key] = key === "screen_sharing_enabled"
          ? (body[key] ? 1 : 0)
          : key === "notification_level"
            ? (NOTIFICATION_LEVELS.has(String(body[key]).toLowerCase()) ? String(body[key]).toLowerCase() : "disaster")
          : sanitizeField(body[key], maxLen);
      }
    }
    const updated = upsertUserProfile(auth.user.id, sanitized);
    addLog({
      level: "verbose",
      source: "api.config.profile",
      message: "Updated profile configuration.",
      metadata: JSON.stringify({ userId: auth.user.id, fields: Object.keys(sanitized) }),
    });
    return NextResponse.json(updated);
  } catch (e: any) {
    addLog({
      level: "error",
      source: "api.config.profile",
      message: "Failed to update profile configuration.",
      metadata: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
