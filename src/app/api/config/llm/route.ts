import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  listLlmProviders,
  createLlmProvider,
  updateLlmProvider,
  deleteLlmProvider,
  getLlmProvider,
  type LlmProviderRecord,
  type LlmProviderType,
  type LlmProviderPurpose,
} from "@/lib/db";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const providers = listLlmProviders().map(serializeRecord);
  return NextResponse.json(providers);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const providerType = body.provider_type;
  const purpose = body.purpose || "chat";
  const config = body.config;
  const isDefault = !!body.is_default;

  if (!label) {
    return NextResponse.json({ error: "label is required." }, { status: 400 });
  }
  if (!isProviderType(providerType)) {
    return NextResponse.json({ error: "provider_type is invalid." }, { status: 400 });
  }
  if (!isPurpose(purpose)) {
    return NextResponse.json({ error: "purpose must be 'chat', 'embedding', or 'audio'." }, { status: 400 });
  }
  if (!config || typeof config !== "object") {
    return NextResponse.json({ error: "config must be an object." }, { status: 400 });
  }

  let normalizedConfig: Record<string, string>;
  try {
    normalizedConfig = buildConfig(providerType, config as Record<string, unknown>, purpose);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  const record = createLlmProvider({ label, providerType, purpose, config: normalizedConfig, isDefault });
  return NextResponse.json(serializeRecord(record), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const id = typeof body.id === "string" ? body.id : null;
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const existing = getLlmProvider(id);
  if (!existing) {
    return NextResponse.json({ error: "Provider not found." }, { status: 404 });
  }

  const updates: {
    id: string;
    label?: string;
    providerType?: LlmProviderType;
    purpose?: LlmProviderPurpose;
    config?: Record<string, unknown>;
    isDefault?: boolean;
  } = { id };

  if (body.label !== undefined) {
    if (typeof body.label !== "string" || !body.label.trim()) {
      return NextResponse.json({ error: "label must be a non-empty string." }, { status: 400 });
    }
    updates.label = body.label.trim();
  }

  let effectiveType: LlmProviderType = existing.provider_type;
  if (body.provider_type !== undefined) {
    if (!isProviderType(body.provider_type)) {
      return NextResponse.json({ error: "provider_type is invalid." }, { status: 400 });
    }
    updates.providerType = body.provider_type;
    effectiveType = body.provider_type;
  }

  if (body.purpose !== undefined) {
    if (!isPurpose(body.purpose)) {
      return NextResponse.json({ error: "purpose must be 'chat', 'embedding', or 'audio'." }, { status: 400 });
    }
    updates.purpose = body.purpose;
  }

  if (body.config !== undefined) {
    if (typeof body.config !== "object" || body.config === null) {
      return NextResponse.json({ error: "config must be an object." }, { status: 400 });
    }
    try {
      updates.config = buildConfig(effectiveType, body.config as Record<string, unknown>, updates.purpose || existing.purpose);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  if (body.is_default !== undefined) {
    updates.isDefault = !!body.is_default;
  }

  const updated = updateLlmProvider(updates);
  if (!updated) {
    return NextResponse.json({ error: "Provider not found." }, { status: 404 });
  }
  return NextResponse.json(serializeRecord(updated));
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  deleteLlmProvider(id);
  return NextResponse.json({ success: true });
}

function serializeRecord(record: LlmProviderRecord) {
  const config = parseConfig(record);
  const hasApiKey = typeof config.apiKey === "string" && config.apiKey.length > 0;
  if (hasApiKey) {
    config.apiKey = "••••••";
  }
  return {
    id: record.id,
    label: record.label,
    provider_type: record.provider_type,
    purpose: record.purpose,
    config,
    is_default: record.is_default === 1,
    created_at: record.created_at,
    has_api_key: hasApiKey,
  };
}

function parseConfig(record: LlmProviderRecord): Record<string, any> {
  try {
    return record.config_json ? JSON.parse(record.config_json) : {};
  } catch {
    return {};
  }
}

function isProviderType(value: unknown): value is LlmProviderType {
  return value === "azure-openai" || value === "openai" || value === "anthropic" || value === "litellm";
}

function isPurpose(value: unknown): value is LlmProviderPurpose {
  return value === "chat" || value === "embedding" || value === "audio";
}

function buildConfig(provider: LlmProviderType, input: Record<string, unknown>, purpose: LlmProviderPurpose = "chat"): Record<string, any> {
  const read = (key: string, required = false) => {
    const raw = input[key];
    if (raw === undefined || raw === null) {
      if (required) throw new Error(`${key} is required`);
      return undefined;
    }
    if (typeof raw !== "string") {
      throw new Error(`${key} must be a string`);
    }
    const value = raw.trim();
    if (!value && required) {
      throw new Error(`${key} is required`);
    }
    return value;
  };

  // Read orchestrator metadata (optional for all providers)
  const routingTier = read("routingTier");
  const VALID_TIERS = ["primary", "secondary", "local"];
  if (routingTier && !VALID_TIERS.includes(routingTier)) {
    throw new Error("routingTier must be 'primary', 'secondary', or 'local'");
  }
  const rawCaps = input.capabilities;
  let capabilities: Record<string, unknown> | undefined;
  if (rawCaps && typeof rawCaps === "object" && !Array.isArray(rawCaps)) {
    capabilities = rawCaps as Record<string, unknown>;
  }

  const orchestratorFields: Record<string, unknown> = {};
  if (routingTier) orchestratorFields.routingTier = routingTier;
  if (capabilities) orchestratorFields.capabilities = capabilities;

  try {
    let base: Record<string, string>;
    if (provider === "azure-openai") {
      const apiKey = read("apiKey", true)!;
      const endpoint = read("endpoint", true)!;
      const apiVersion = read("apiVersion");

      if (purpose === "audio") {
        // Audio providers use separate TTS/STT deployments instead of a single deployment
        const ttsDeployment = read("ttsDeployment") || "tts";
        const sttDeployment = read("sttDeployment") || "whisper";
        base = {
          apiKey,
          endpoint,
          ttsDeployment,
          sttDeployment,
          ...(apiVersion ? { apiVersion } : {}),
        };
      } else {
        const deployment = read("deployment", true)!;
        base = {
          apiKey,
          endpoint,
          deployment,
          ...(apiVersion ? { apiVersion } : {}),
        };
      }
    } else if (provider === "openai") {
      const apiKey = read("apiKey", true)!;
      const model = read("model");
      const baseURL = read("baseURL");
      base = {
        apiKey,
        ...(model ? { model } : {}),
        ...(baseURL ? { baseURL } : {}),
      };
    } else if (provider === "litellm") {
      const baseURL = read("baseURL", true)!;
      const model = read("model", true)!;
      const apiKey = read("apiKey");
      base = {
        baseURL,
        model,
        ...(apiKey ? { apiKey } : {}),
      };
    } else {
      const apiKey = read("apiKey", true)!;
      const model = read("model");
      base = {
        apiKey,
        ...(model ? { model } : {}),
      };
    }

    return { ...base, ...orchestratorFields };
  } catch (err) {
    throw new Error((err as Error).message);
  }
}
