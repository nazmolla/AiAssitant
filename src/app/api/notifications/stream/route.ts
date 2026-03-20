import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/connection";
import { allowedTypesForLevel } from "@/lib/db/notification-queries";
import type { NotificationRecord } from "@/lib/db/notification-queries";
import { sseEvent } from "@/lib/sse";
import { SSE_HEARTBEAT_INTERVAL_MS } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_NOTIFICATION_POLL_MS = 3000;

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const userId = auth.user.id;

  // Resolve per-user in-app notification level threshold once at stream-open
  const profileRow = getDb()
    .prepare("SELECT notification_level_inapp FROM user_profiles WHERE user_id = ?")
    .get(userId) as { notification_level_inapp?: string } | undefined;
  const minLevel = profileRow?.notification_level_inapp ?? "low";
  const allowedTypes = allowedTypesForLevel(minLevel);
  const typeClause = allowedTypes
    ? `AND (notify_type IN (${allowedTypes.map(() => "?").join(",")}) OR notify_type IS NULL)`
    : "";

  // Start cursor at the latest notification row id so we only stream NEW ones
  let cursor: number = (() => {
    try {
      const params: (string | number)[] = allowedTypes
        ? [userId, ...allowedTypes]
        : [userId];
      const row = getDb()
        .prepare(
          `SELECT id FROM agent_logs WHERE notify = 1 AND notify_user_id = ? ${typeClause} ORDER BY created_at DESC LIMIT 1`
        )
        .get(...params) as { id: number } | undefined;
      return row?.id ?? 0;
    } catch {
      return 0;
    }
  })();

  const encoder = new TextEncoder();
  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const send = (chunk: string) => {
    if (closed || !controller) return;
    try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; }
  };

  const tick = () => {
    if (closed) return;
    try {
      const db = getDb();
      const params: (string | number)[] = allowedTypes
        ? [userId, ...allowedTypes, cursor]
        : [userId, cursor];
      const rows = db
        .prepare(
          `SELECT id, notify_user_id as user_id, notify_type as type, message as title,
                  notify_body as body, metadata, notify_read as read, created_at
           FROM agent_logs
           WHERE notify = 1 AND notify_user_id = ? ${typeClause} AND id > ?
           ORDER BY id ASC LIMIT 50`
        )
        .all(...params) as NotificationRecord[];
      for (const row of rows) {
        send(sseEvent("notification", row));
        cursor = row.id;
      }
    } catch { /* DB temporarily unavailable */ }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      send(": notification stream opened\n\n");
      send(sseEvent("cursor", { latestId: cursor }));
      pollTimer = setInterval(tick, SSE_NOTIFICATION_POLL_MS);
      heartbeatTimer = setInterval(() => {
        send(sseEvent("heartbeat", { ts: Date.now() }));
      }, SSE_HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
