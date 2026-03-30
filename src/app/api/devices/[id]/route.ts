import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getApiKeyById, deleteApiKey } from "@/lib/db/api-key-queries";

/**
 * DELETE /api/devices/:id
 * Revoke a registered device (delete its API key). Ownership is validated.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const key = getApiKeyById(id);

  if (!key) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  if (key.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify it is actually a device key
  try {
    const scopes: string[] = JSON.parse(key.scopes);
    if (!scopes.includes("device")) {
      return NextResponse.json({ error: "Not a device key" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid key scopes" }, { status: 400 });
  }

  deleteApiKey(id);
  return new NextResponse(null, { status: 204 });
}
