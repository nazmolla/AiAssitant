import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getLogsAfterId, type AgentLog } from "@/lib/db";
import { isUnifiedLogLevel } from "@/lib/logging/levels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireLogsReadAccess() {
  const auth = await requireUser();
  if ("error" in auth) return auth;

  if (!auth.user.apiKeyScopes) {
    if (auth.user.role === "admin") return auth;
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  if (!auth.user.apiKeyScopes.includes("logs")) {
    return { error: NextResponse.json({ error: "API key missing required scope: logs" }, { status: 403 }) };
  }

  return auth;
}

function toSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest) {
  const auth = await requireLogsReadAccess();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get("sinceId") ?? "0";
  const levelParam = (searchParams.get("level") || "all").trim().toLowerCase();
  const sourceParam = (searchParams.get("source") || "all").trim().toLowerCase();

  const level = isUnifiedLogLevel(levelParam) ? levelParam : "all";
  const source = sourceParam || "all";
  let cursor = Number.parseInt(sinceParam, 10);
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

  const encoder = new TextEncoder();
  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const send = (chunk: string) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      closed = true;
    }
  };

  const sendLogs = (logs: AgentLog[]) => {
    for (const log of logs) {
      send(toSse("log", log));
      cursor = log.id;
    }
  };

  const tick = () => {
    if (closed) return;
    const rows = getLogsAfterId(cursor, 200, level, source);
    if (rows.length > 0) {
      sendLogs(rows);
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      send(": stream opened\n\n");
      send(toSse("cursor", { sinceId: cursor }));

      const initial = getLogsAfterId(cursor, 200, level, source);
      if (initial.length > 0) {
        sendLogs(initial);
      }

      pollTimer = setInterval(tick, 2000); // 2s — halves per-client DB load vs 1s
      heartbeatTimer = setInterval(() => {
        send(toSse("heartbeat", { sinceId: cursor, ts: Date.now() }));
      }, 15000);
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
