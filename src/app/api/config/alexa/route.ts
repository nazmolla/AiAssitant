import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getAlexaConfig, saveAlexaConfig } from "@/lib/agent/alexa-tools";

/** GET /api/config/alexa — read current Alexa credentials (masked) */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const cfg = getAlexaConfig();
  if (!cfg) {
    return NextResponse.json({ configured: false, ubidMain: "", atMain: "" });
  }

  return NextResponse.json({
    configured: true,
    ubidMain: cfg.ubidMain.slice(0, 6) + "•••" + cfg.ubidMain.slice(-4),
    atMain: cfg.atMain.slice(0, 8) + "•••" + cfg.atMain.slice(-4),
  });
}

/** PUT /api/config/alexa — store encrypted Alexa credentials */
export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { ubidMain, atMain } = body as { ubidMain?: string; atMain?: string };

  if (!ubidMain || !atMain) {
    return NextResponse.json({ error: "Both ubidMain and atMain are required." }, { status: 400 });
  }

  saveAlexaConfig(ubidMain.trim(), atMain.trim());
  return NextResponse.json({ ok: true });
}
