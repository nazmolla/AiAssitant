import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { getApiKeyByRawKey, touchApiKey } from "@/lib/db/api-key-queries";
import { createThread, getThread } from "@/lib/db/thread-queries";
import { env } from "@/lib/env";

/**
 * POST /api/livekit/token
 *
 * Authenticates an ESP32 device via Bearer token (device API key) and returns
 * a short-lived LiveKit JWT to join a room. The room name equals the thread ID,
 * creating the canonical LiveKit room = Nexus thread mapping.
 *
 * Body: { threadId?: string }
 * Auth: Authorization: Bearer <device-api-key>
 *
 * Returns: { token, wsUrl, threadId, roomName }
 */
export async function POST(req: NextRequest) {
  const livekitUrl = env.LIVEKIT_URL;
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;

  if (!livekitUrl || !apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "LiveKit is not configured on this server" },
      { status: 503 }
    );
  }

  // Authenticate device via Bearer token
  const authHeader = req.headers.get("authorization") ?? "";
  const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!rawKey) {
    return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
  }

  const deviceKey = getApiKeyByRawKey(rawKey);
  if (!deviceKey) {
    return NextResponse.json({ error: "Invalid or revoked device key" }, { status: 401 });
  }

  // Confirm it is a device-scoped key
  let scopes: string[];
  try {
    scopes = JSON.parse(deviceKey.scopes);
  } catch {
    return NextResponse.json({ error: "Malformed key scopes" }, { status: 401 });
  }
  if (!scopes.includes("device")) {
    return NextResponse.json({ error: "Key does not have device scope" }, { status: 403 });
  }

  const userId = deviceKey.user_id;
  touchApiKey(deviceKey.id);

  // Resolve or create thread
  let body: { threadId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body is optional
  }

  let threadId: string;
  if (body.threadId) {
    const thread = getThread(body.threadId);
    if (!thread || thread.user_id !== userId) {
      return NextResponse.json({ error: "Thread not found or forbidden" }, { status: 404 });
    }
    threadId = body.threadId;
  } else {
    const thread = createThread("ESP32 Voice Session", userId);
    threadId = thread.id;
  }

  // Room name IS the thread ID
  const roomName = threadId;

  // Generate short-lived LiveKit JWT (1 hour)
  const token = new AccessToken(apiKey, apiSecret, {
    identity: `device-${deviceKey.id}`,
    ttl: 3600,
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  return NextResponse.json({
    token: await token.toJwt(),
    wsUrl: livekitUrl,
    threadId,
    roomName,
  });
}
