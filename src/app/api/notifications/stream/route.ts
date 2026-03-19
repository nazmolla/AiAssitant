import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/connection";
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

  // Start cursor at the latest notification id so we only stream NEW ones
  let cursor: string = (() => {
    try {
      const row = getDb()
        .prepare("SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(userId) as { id: string } | undefined;
      return row?.id ?? "";
    } catch {
      return "";
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
      let rows: NotificationRecord[];
      if (cursor) {
        rows = db
          .prepare(
            `SELECT * FROM notifications
             WHERE user_id = ?
               AND created_at > (SELECT created_at FROM notifications WHERE id = ?)
             ORDER BY created_at ASC LIMIT 50`
          )
          .all(userId, cursor) as NotificationRecord[];
      } else {
        rows = [];
      }
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
