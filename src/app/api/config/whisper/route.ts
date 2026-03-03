import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getAppConfig, setAppConfig, addLog } from "@/lib/db";
import { getLocalWhisperConfig } from "@/lib/audio";

export const dynamic = "force-dynamic";

/**
 * GET /api/config/whisper — read local Whisper configuration
 */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const config = getLocalWhisperConfig();

  return NextResponse.json({
    enabled: config.enabled,
    url: config.url,
    model: config.model,
  });
}

/**
 * PUT /api/config/whisper — update local Whisper configuration
 */
export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { enabled, url, model } = body as {
    enabled?: boolean;
    url?: string;
    model?: string;
  };

  if (enabled !== undefined) {
    setAppConfig("whisper_local_enabled", String(enabled));
  }

  if (url !== undefined) {
    if (url) {
      // Validate URL structure and protocol
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return NextResponse.json(
          { error: "Invalid URL format." },
          { status: 400 }
        );
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return NextResponse.json(
          { error: "URL must use http:// or https:// protocol." },
          { status: 400 }
        );
      }
      // Block cloud metadata IPs
      const blockedHosts = ['169.254.169.254', 'metadata.google.internal', 'metadata.azure.com'];
      if (blockedHosts.includes(parsed.hostname)) {
        return NextResponse.json(
          { error: "URL points to a blocked metadata endpoint." },
          { status: 400 }
        );
      }
    }
    setAppConfig("whisper_local_url", url.replace(/\/$/, ""));
  }

  if (model !== undefined) {
    const trimmedModel = (model || "whisper-1").slice(0, 128);
    setAppConfig("whisper_local_model", trimmedModel);
  }

  addLog({
    level: "info",
    source: "config",
    message: `Local Whisper config updated: enabled=${enabled ?? getAppConfig("whisper_local_enabled")}, url=${url ?? getAppConfig("whisper_local_url")}`,
    metadata: JSON.stringify({ enabled, url, model }),
  });

  return NextResponse.json({ ok: true });
}

/**
 * POST /api/config/whisper/test — test connectivity to local Whisper server
 */
export async function POST() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const config = getLocalWhisperConfig();

  if (!config.url) {
    return NextResponse.json(
      { ok: false, error: "No local Whisper URL configured." },
      { status: 400 }
    );
  }

  try {
    const baseUrl = config.url.replace(/\/$/, "");

    // Try health endpoint first, then models endpoint
    let healthy = false;
    let detail = "";

    for (const path of ["/health", "/v1/models", "/"]) {
      try {
        const res = await fetch(`${baseUrl}${path}`, {
          method: "GET",
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          healthy = true;
          detail = `${path} returned ${res.status}`;
          break;
        }
      } catch {
        // Try next path
      }
    }

    if (healthy) {
      addLog({
        level: "info",
        source: "config",
        message: `Local Whisper connectivity test passed: ${config.url} (${detail})`,
        metadata: JSON.stringify({ url: config.url, detail }),
      });
      return NextResponse.json({ ok: true, detail });
    }

    return NextResponse.json(
      { ok: false, error: `Could not reach ${config.url} — no health endpoint responded.` },
      { status: 502 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `Connection failed: ${message}` },
      { status: 502 }
    );
  }
}
