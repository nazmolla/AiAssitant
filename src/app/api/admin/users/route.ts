import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import {
  listUsersWithPermissions,
  updateUserRole,
  updateUserEnabled,
  updateUserPermissions,
  deleteUser,
  getUserPermissions,
} from "@/lib/db/user-queries";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("api.admin.users");

/**
 * GET /api/admin/users — List all users with permissions (admin only)
 */
export async function GET(): Promise<NextResponse> {
  const t0 = Date.now();
  log.enter("GET /api/admin/users");
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const users = listUsersWithPermissions();

  // Strip password hashes from response
  const sanitized = users.map(({ password_hash, ...rest }) => rest);
  log.exit("GET /api/admin/users", { count: sanitized.length }, Date.now() - t0);
  return NextResponse.json(sanitized);
}

/**
 * PUT /api/admin/users — Update a user's role, enabled status, or permissions (admin only)
 *
 * Body: { userId, role?, enabled?, permissions?: { chat?, knowledge?, ... } }
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();
  log.enter("PUT /api/admin/users");
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { userId, role, enabled, permissions } = body;

  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // Validate userId format (UUID)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid userId format" }, { status: 400 });
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
    log.exit("PUT /api/admin/users", { userId }, Date.now() - t0);
    return NextResponse.json({ ok: true, permissions: updatedPerms });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error("PUT /api/admin/users failed", { userId }, err instanceof Error ? err : new Error(message));
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * DELETE /api/admin/users — Delete a user (admin only)
 *
 * Body: { userId }
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();
  log.enter("DELETE /api/admin/users");
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { userId } = body;

  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // Validate userId format (UUID)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid userId format" }, { status: 400 });
  }

  // Prevent admin from deleting themselves
  if (userId === guard.user.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  deleteUser(userId);
  log.exit("DELETE /api/admin/users", { userId }, Date.now() - t0);
  return NextResponse.json({ ok: true });
}
