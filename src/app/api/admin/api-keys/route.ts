import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import {
  listAllApiKeys,
  deleteApiKey,
  getApiKeyById,
} from "@/lib/db/queries";
import { addLog } from "@/lib/db/log-queries";

/**
 * GET /api/admin/api-keys  — list all API keys (admin only)
 */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const keys = listAllApiKeys();
  return NextResponse.json(keys);
}

/**
 * DELETE /api/admin/api-keys  — revoke any API key (admin only)
 *
 * Body: { id: string }
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const keyId = typeof body.id === "string" ? body.id : "";
  if (!keyId) {
    return NextResponse.json({ error: "Key ID is required." }, { status: 400 });
  }

  const key = getApiKeyById(keyId);
  if (!key) {
    return NextResponse.json({ error: "Key not found." }, { status: 404 });
  }

  deleteApiKey(keyId);

  addLog({
    level: "info",
    source: "api.admin.api-keys",
    message: `Admin revoked API key: "${key.name}" (${key.key_prefix}…) owned by user ${key.user_id}`,
    metadata: JSON.stringify({ adminId: auth.user.id, keyId, ownerId: key.user_id }),
  });

  return NextResponse.json({ ok: true });
}
