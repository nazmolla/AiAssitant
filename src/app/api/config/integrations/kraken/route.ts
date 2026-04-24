import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import {
  getUserIntegration,
  upsertUserIntegration,
  deleteUserIntegration,
} from "@/lib/db/user-trading-queries";

export const dynamic = "force-dynamic";

const MAX_KEY_LEN = 128;
const MAX_SECRET_LEN = 512;

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const integration = getUserIntegration(auth.user.id, "kraken");
  if (!integration) {
    return NextResponse.json({ hasCredentials: false, apiKeyPrefix: null, updatedAt: null });
  }

  return NextResponse.json({
    hasCredentials: true,
    apiKeyPrefix: integration.api_key.slice(0, 8),
    updatedAt: integration.updated_at,
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  let body: { apiKey?: unknown; apiSecret?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const apiSecret = typeof body.apiSecret === "string" ? body.apiSecret.trim() : "";

  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: "apiKey and apiSecret are required." }, { status: 400 });
  }
  if (apiKey.length > MAX_KEY_LEN || apiSecret.length > MAX_SECRET_LEN) {
    return NextResponse.json({ error: "Credential fields exceed maximum length." }, { status: 400 });
  }

  upsertUserIntegration(auth.user.id, "kraken", apiKey, apiSecret);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  deleteUserIntegration(auth.user.id, "kraken");
  return NextResponse.json({ ok: true });
}
