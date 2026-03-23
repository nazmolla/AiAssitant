import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  listAuthProviders,
  upsertAuthProvider,
  deleteAuthProvider,
  getAuthProvider,
  type AuthProviderType,
} from "@/lib/db/auth-provider-queries";

const VALID_TYPES = new Set<AuthProviderType>(["azure-ad", "google", "discord"]);

export async function GET(): Promise<NextResponse> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const providers = listAuthProviders().map(sanitize);
  return NextResponse.json(providers);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const providerType = body.provider_type as AuthProviderType;
  const label = typeof body.label === "string" ? body.label.trim() : "";

  if (!label) {
    return NextResponse.json({ error: "label is required." }, { status: 400 });
  }
  if (!VALID_TYPES.has(providerType)) {
    return NextResponse.json(
      { error: "provider_type must be 'azure-ad', 'google', or 'discord'." },
      { status: 400 }
    );
  }

  // Validate required fields per type
  if (providerType === "azure-ad") {
    if (!body.client_id || !body.client_secret || !body.tenant_id) {
      return NextResponse.json(
        { error: "Azure AD requires client_id, client_secret, and tenant_id." },
        { status: 400 }
      );
    }
  } else if (providerType === "google") {
    if (!body.client_id || !body.client_secret) {
      return NextResponse.json(
        { error: "Google requires client_id and client_secret." },
        { status: 400 }
      );
    }
  } else if (providerType === "discord") {
    if (!body.bot_token || !body.application_id) {
      return NextResponse.json(
        { error: "Discord requires bot_token and application_id." },
        { status: 400 }
      );
    }
  }

  const record = upsertAuthProvider({
    providerType,
    label,
    clientId: body.client_id || null,
    clientSecret: body.client_secret || null,
    tenantId: body.tenant_id || null,
    botToken: body.bot_token || null,
    applicationId: body.application_id || null,
    enabled: body.enabled !== false,
  });

  return NextResponse.json(sanitize(record), { status: 201 });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : null;
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const existing = getAuthProvider(id);
  if (!existing) {
    return NextResponse.json({ error: "Provider not found." }, { status: 404 });
  }

  const record = upsertAuthProvider({
    providerType: existing.provider_type,
    label: body.label ?? existing.label,
    clientId: body.client_id !== undefined ? body.client_id : existing.client_id,
    clientSecret: body.client_secret !== undefined ? body.client_secret : existing.client_secret,
    tenantId: body.tenant_id !== undefined ? body.tenant_id : existing.tenant_id,
    botToken: body.bot_token !== undefined ? body.bot_token : existing.bot_token,
    applicationId: body.application_id !== undefined ? body.application_id : existing.application_id,
    enabled: body.enabled !== undefined ? body.enabled : !!existing.enabled,
  });

  return NextResponse.json(sanitize(record));
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param is required." }, { status: 400 });
  }

  const existing = getAuthProvider(id);
  if (!existing) {
    return NextResponse.json({ error: "Provider not found." }, { status: 404 });
  }

  deleteAuthProvider(id);
  return NextResponse.json({ success: true });
}

/** Strip secrets from responses — show only presence */
function sanitize(r: { id: string; provider_type: string; label: string; client_id: string | null; client_secret: string | null; tenant_id: string | null; bot_token: string | null; application_id: string | null; enabled: number; created_at: string }) {
  return {
    id: r.id,
    provider_type: r.provider_type,
    label: r.label,
    client_id: r.client_id,
    has_client_secret: !!r.client_secret,
    tenant_id: r.tenant_id,
    has_bot_token: !!r.bot_token,
    application_id: r.application_id,
    enabled: !!r.enabled,
    created_at: r.created_at,
  };
}
