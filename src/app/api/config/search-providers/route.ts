import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  getWebSearchProviderConfig,
  saveWebSearchProviderConfig,
  type WebSearchProviderRecord,
} from "@/lib/db";

const VALID_TYPES = new Set(["duckduckgo-html", "duckduckgo-instant", "brave"]);

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const providers = getWebSearchProviderConfig().map((provider) => ({
    type: provider.type,
    label: provider.label,
    enabled: provider.enabled,
    priority: provider.priority,
    hasApiKey: !!provider.apiKey,
  }));

  return NextResponse.json({ providers });
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const incoming = Array.isArray(body?.providers) ? body.providers : null;
    if (!incoming) {
      return NextResponse.json({ error: "providers array is required." }, { status: 400 });
    }

    const existingByType = new Map(
      getWebSearchProviderConfig().map((provider) => [provider.type, provider])
    );

    const providers: WebSearchProviderRecord[] = [];
    for (const item of incoming) {
      const type = String(item?.type || "").trim();
      if (!VALID_TYPES.has(type)) {
        return NextResponse.json({ error: `Invalid provider type: ${type}` }, { status: 400 });
      }

      const existing = existingByType.get(type as WebSearchProviderRecord["type"]);
      const apiKey = typeof item?.apiKey === "string"
        ? item.apiKey.trim() || undefined
        : existing?.apiKey;

      providers.push({
        type: type as WebSearchProviderRecord["type"],
        label: typeof item?.label === "string" && item.label.trim().length > 0
          ? item.label.trim()
          : existing?.label || type,
        enabled: !!item?.enabled,
        priority: Number.isFinite(item?.priority) ? Number(item.priority) : existing?.priority || 99,
        apiKey,
      });
    }

    const saved = saveWebSearchProviderConfig(providers);

    return NextResponse.json({
      ok: true,
      providers: saved.map((provider) => ({
        type: provider.type,
        label: provider.label,
        enabled: provider.enabled,
        priority: provider.priority,
        hasApiKey: !!provider.apiKey,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save search providers." },
      { status: 500 }
    );
  }
}
