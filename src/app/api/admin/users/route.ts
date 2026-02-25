import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import {
  listUsersWithPermissions,
  updateUserRole,
  updateUserEnabled,
  updateUserPermissions,
  deleteUser,
  getUserPermissions,
} from "@/lib/db";

/**
 * GET /api/admin/users — List all users with permissions (admin only)
 */
export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const users = listUsersWithPermissions();

  // Strip password hashes from response
  const sanitized = users.map(({ password_hash, ...rest }) => rest);
  return NextResponse.json(sanitized);
}

/**
 * PUT /api/admin/users — Update a user's role, enabled status, or permissions (admin only)
 *
 * Body: { userId, role?, enabled?, permissions?: { chat?, knowledge?, ... } }
 */
export async function PUT(req: NextRequest) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const body = await req.json();
  const { userId, role, enabled, permissions } = body;

  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // Prevent admin from disabling or demoting themselves
  if (userId === guard.user.id) {
    if (role && role !== "admin") {
      return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
    }
    if (enabled === false || enabled === 0) {
      return NextResponse.json({ error: "Cannot disable your own account" }, { status: 400 });
    }
  }

  try {
    if (role !== undefined) {
      updateUserRole(userId, role);
    }
    if (enabled !== undefined) {
      updateUserEnabled(userId, !!enabled);
    }
    if (permissions && typeof permissions === "object") {
      updateUserPermissions(userId, permissions);
    }

    const updatedPerms = getUserPermissions(userId);
    return NextResponse.json({ ok: true, permissions: updatedPerms });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * DELETE /api/admin/users — Delete a user (admin only)
 *
 * Body: { userId }
 */
export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const body = await req.json();
  const { userId } = body;

  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // Prevent admin from deleting themselves
  if (userId === guard.user.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  deleteUser(userId);
  return NextResponse.json({ ok: true });
}
