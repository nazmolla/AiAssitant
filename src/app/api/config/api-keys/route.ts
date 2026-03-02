import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import {
  createApiKey,
  listApiKeys,
  deleteApiKey,
  getApiKeyById,
  API_KEY_SCOPES,
  type ApiKeyScope,
} from "@/lib/db/queries";
import { addLog } from "@/lib/db";

/**
 * GET /api/config/api-keys  — list the authenticated user's API keys
 * API key management requires session auth — an API key cannot list/create/delete keys.
 */
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  if (auth.user.apiKeyScopes) {
    return NextResponse.json({ error: "API key management requires session authentication." }, { status: 403 });
  }

  const keys = listApiKeys(auth.user.id);
  return NextResponse.json(keys);
}

/**
 * POST /api/config/api-keys  — create a new API key for the current user
 *
 * Body: { name: string, scopes?: string[], expiresAt?: string }
 * Returns the full key (shown once) plus the DB record.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  if (auth.user.apiKeyScopes) {
    return NextResponse.json({ error: "API key management requires session authentication." }, { status: 403 });
  }

  const body = await req.json();
  const name = (body.name ?? "").trim().slice(0, 100); // max 100 chars
  if (!name) {
    return NextResponse.json({ error: "Key name is required." }, { status: 400 });
  }

  // Validate scopes
  const scopes: ApiKeyScope[] = body.scopes ?? ["chat"];
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return NextResponse.json({ error: "At least one scope is required." }, { status: 400 });
  }
  for (const s of scopes) {
    if (!API_KEY_SCOPES.includes(s)) {
      return NextResponse.json(
        { error: `Invalid scope: "${s}". Valid scopes: ${API_KEY_SCOPES.join(", ")}` },
        { status: 400 }
      );
    }
  }

  // Validate optional expiry
  let expiresAt: string | null = null;
  if (body.expiresAt) {
    const d = new Date(body.expiresAt);
    if (isNaN(d.getTime()) || d <= new Date()) {
      return NextResponse.json({ error: "expiresAt must be a valid future date." }, { status: 400 });
    }
    expiresAt = d.toISOString();
  }

  // Cap keys per user to 20
  const existing = listApiKeys(auth.user.id);
  if (existing.length >= 20) {
    return NextResponse.json({ error: "Maximum 20 API keys per user." }, { status: 400 });
  }

  const { record, rawKey } = createApiKey({
    userId: auth.user.id,
    name,
    scopes,
    expiresAt,
  });

  addLog({
    level: "info",
    source: "api.api-keys",
    message: `API key created: "${name.slice(0, 50)}" (${record.key_prefix}…)`,
    metadata: JSON.stringify({ userId: auth.user.id, keyId: record.id, scopes }),
  });

  // Strip key_hash — never expose the hash to the client
  const { key_hash: _omit, ...safeRecord } = record;
  return NextResponse.json({ ...safeRecord, rawKey }, { status: 201 });
}

/**
 * DELETE /api/config/api-keys  — revoke one of the current user's API keys
 *
 * Body: { id: string }
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  if (auth.user.apiKeyScopes) {
    return NextResponse.json({ error: "API key management requires session authentication." }, { status: 403 });
  }

  const body = await req.json();
  const keyId = body.id;
  if (!keyId) {
    return NextResponse.json({ error: "Key ID is required." }, { status: 400 });
  }

  // Ensure the key belongs to this user
  const key = getApiKeyById(keyId);
  if (!key || key.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Key not found." }, { status: 404 });
  }

  deleteApiKey(keyId);

  addLog({
    level: "info",
    source: "api.api-keys",
    message: `API key revoked: "${key.name}" (${key.key_prefix}…)`,
    metadata: JSON.stringify({ userId: auth.user.id, keyId }),
  });

  return NextResponse.json({ ok: true });
}
