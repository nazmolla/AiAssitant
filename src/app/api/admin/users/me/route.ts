import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getUserById, getUserPermissions } from "@/lib/db";

/**
 * GET /api/admin/users/me — Get the current user's role and permissions.
 * Available to any authenticated user (not admin-only).
 */
export async function GET() {
  const guard = await requireUser();
  if ("error" in guard) return guard.error;

  const dbUser = getUserById(guard.user.id);
  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const perms = getUserPermissions(guard.user.id);
  const isAdmin = dbUser.role === "admin";

  return NextResponse.json({
    role: dbUser.role,
    provider_id: dbUser.provider_id,
    permissions: perms || {
      user_id: guard.user.id,
      chat: 1,
      knowledge: 1,
      dashboard: 1,
      approvals: 1,
      mcp_servers: 1,
      channels: isAdmin ? 1 : 0,
      llm_config: isAdmin ? 1 : 0,
      screen_sharing: 1,
    },
  });
}
