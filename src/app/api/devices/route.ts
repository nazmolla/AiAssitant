import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { createApiKey, listApiKeys } from "@/lib/db/api-key-queries";

/**
 * GET /api/devices
 * List all registered ESP32 devices for the authenticated user.
 * Returns api_key records that have scope "device" (no key_hash exposed).
 */
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const keys = listApiKeys(auth.user.id);
  const devices = keys.filter((k) => {
    try {
      const scopes: string[] = JSON.parse(k.scopes);
      return scopes.includes("device");
    } catch {
      return false;
    }
  });

  return NextResponse.json(devices);
}

/**
 * POST /api/devices
 * Register a new ESP32 device. Returns the raw API key once — store it on the device.
 * Body: { name: string }
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Device name is required" }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "Device name too long (max 100 chars)" }, { status: 400 });
  }

  const { record, rawKey } = createApiKey({
    userId: auth.user.id,
    name,
    scopes: ["device"],
  });

  return NextResponse.json({ ...record, rawKey }, { status: 201 });
}
