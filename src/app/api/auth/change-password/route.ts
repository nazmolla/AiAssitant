import { NextResponse } from "next/server";
import { compare, hash } from "bcryptjs";
import { requireUser } from "@/lib/auth/guard";
import { getUserById, updateUserPassword, addLog } from "@/lib/db";

const LOCAL_SALT_ROUNDS = 12;

export async function POST(req: Request) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;

    const body = await req.json();
    const { currentPassword, newPassword } = body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current password and new password are required." },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "New password must be at least 8 characters." },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from current password." },
        { status: 400 }
      );
    }

    // Fetch the full user record to check provider and verify current password
    const user = getUserById(auth.user.id);
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    if (user.provider_id !== "local") {
      return NextResponse.json(
        { error: "Password changes are only available for local accounts. Your account uses external authentication." },
        { status: 400 }
      );
    }

    if (!user.password_hash) {
      return NextResponse.json(
        { error: "No password set for this account." },
        { status: 400 }
      );
    }

    // Verify current password
    const isValid = await compare(currentPassword, user.password_hash);
    if (!isValid) {
      addLog({
        level: "warn",
        source: "api.auth.change-password",
        message: "Failed password change attempt — incorrect current password.",
        metadata: JSON.stringify({ userId: auth.user.id, email: auth.user.email }),
      });
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 403 }
      );
    }

    // Hash and save new password
    const newHash = await hash(newPassword, LOCAL_SALT_ROUNDS);
    updateUserPassword(auth.user.id, newHash);

    addLog({
      level: "info",
      source: "api.auth.change-password",
      message: "Password changed successfully.",
      metadata: JSON.stringify({ userId: auth.user.id, email: auth.user.email }),
    });

    return NextResponse.json({ success: true, message: "Password changed successfully." });
  } catch (e: unknown) {
    addLog({
      level: "error",
      source: "api.auth.change-password",
      message: "Failed to change password.",
      metadata: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
