import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getUserByEmail, getUserEmailsByUserId, addUserEmail, removeUserEmail, addLog } from "@/lib/db";

export const dynamic = "force-dynamic";

// Email validation regex - basic check for valid email format
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: unknown): email is string {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  return EMAIL_REGEX.test(trimmed) && trimmed.length > 0 && trimmed.length <= 255;
}

export async function GET() {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;

    const primaryEmail = auth.user.email;
    const secondaryEmails = getUserEmailsByUserId(auth.user.id);

    addLog({
      level: "verbose",
      source: "api.config.user-emails",
      message: "Listed user emails.",
      metadata: JSON.stringify({ userId: auth.user.id, secondaryCount: secondaryEmails.length }),
    });

    return NextResponse.json({
      primary: primaryEmail,
      secondary: secondaryEmails,
    });
  } catch (e: any) {
    addLog({
      level: "error",
      source: "api.config.user-emails",
      message: "Failed to list user emails.",
      metadata: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;

    const body = await req.json();
    const { email } = body;

    if (!validateEmail(email)) {
      addLog({
        level: "warn",
        source: "api.config.user-emails",
        message: "Invalid email format provided.",
        metadata: JSON.stringify({ userId: auth.user.id, email: email?.toString() ?? "undefined" }),
      });
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if email is already the primary email
    if (normalizedEmail === auth.user.email.toLowerCase()) {
      return NextResponse.json({ error: "Email is already your primary email" }, { status: 400 });
    }

    // Check if email is already registered as secondary
    const existing = getUserByEmail(normalizedEmail);
    if (existing) {
      addLog({
        level: "warn",
        source: "api.config.user-emails",
        message: "Attempted to add email already registered.",
        metadata: JSON.stringify({ userId: auth.user.id, email: normalizedEmail }),
      });
      return NextResponse.json({ error: "Email is already registered" }, { status: 409 });
    }

    addUserEmail(auth.user.id, normalizedEmail);

    addLog({
      level: "info",
      source: "api.config.user-emails",
      message: "Added secondary email address.",
      metadata: JSON.stringify({ userId: auth.user.id }),
    });

    return NextResponse.json({ success: true, email: normalizedEmail });
  } catch (e: any) {
    addLog({
      level: "error",
      source: "api.config.user-emails",
      message: "Failed to add secondary email.",
      metadata: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;

    const body = await req.json();
    const { email } = body;

    if (!validateEmail(email)) {
      addLog({
        level: "warn",
        source: "api.config.user-emails",
        message: "Invalid email format provided for deletion.",
        metadata: JSON.stringify({ userId: auth.user.id }),
      });
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Prevent deletion of primary email
    if (normalizedEmail === auth.user.email.toLowerCase()) {
      return NextResponse.json({ error: "Cannot remove primary email address" }, { status: 400 });
    }

    // Verify email belongs to current user
    const secondaryEmails = getUserEmailsByUserId(auth.user.id);
    if (!secondaryEmails.some(e => e.toLowerCase() === normalizedEmail)) {
      addLog({
        level: "warn",
        source: "api.config.user-emails",
        message: "Attempted to remove email not belonging to user.",
        metadata: JSON.stringify({ userId: auth.user.id }),
      });
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }

    removeUserEmail(auth.user.id, normalizedEmail);

    addLog({
      level: "info",
      source: "api.config.user-emails",
      message: "Removed secondary email address.",
      metadata: JSON.stringify({ userId: auth.user.id }),
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    addLog({
      level: "error",
      source: "api.config.user-emails",
      message: "Failed to remove secondary email.",
      metadata: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
