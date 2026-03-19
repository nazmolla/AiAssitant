import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { listThreadsPaginated, createThread } from "@/lib/db/thread-queries";
import { addLog } from "@/lib/db/log-queries";
import { initializeDatabase } from "@/lib/db/init";
import { THREADS_DEFAULT_LIMIT, THREADS_MAX_LIMIT } from "@/lib/constants";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("api.threads");

let dbReady = false;

type ThreadsRouteDeps = {
  requireUser: typeof requireUser;
  listThreadsPaginated: typeof listThreadsPaginated;
  createThread: typeof createThread;
  addLog: typeof addLog;
  initializeDatabase: typeof initializeDatabase;
};

const deps: ThreadsRouteDeps = {
  requireUser,
  listThreadsPaginated,
  createThread,
  addLog,
  initializeDatabase,
};

function ensureThreadRouteDbReady(): { ok: true } | { ok: false; response: NextResponse } {
  if (dbReady) return { ok: true };

  try {
    deps.initializeDatabase();
    dbReady = true;
    deps.addLog({
      level: "verbose",
      source: "api.threads",
      message: "Database initialized for threads route.",
      metadata: JSON.stringify({ pid: process.pid }),
    });
    return { ok: true };
  } catch (err) {
    deps.addLog({
      level: "critical",
      source: "api.threads",
      message: "Failed to initialize database for threads route.",
      metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    });
    return { ok: false, response: NextResponse.json({ error: "Database initialization failed." }, { status: 500 }) };
  }
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  log.enter("GET /api/threads");
  const dbState = ensureThreadRouteDbReady();
  if (!dbState.ok) return dbState.response;

  try {
    const auth = await deps.requireUser();
    if ("error" in auth) return auth.error;

    const url = req.nextUrl;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || String(THREADS_DEFAULT_LIMIT), 10) || THREADS_DEFAULT_LIMIT, 1), THREADS_MAX_LIMIT);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

    const result = deps.listThreadsPaginated(auth.user.id, limit, offset);
    log.exit("GET /api/threads", { count: result.data?.length }, Date.now() - t0);
    return NextResponse.json(result);
  } catch (err) {
    log.error("GET /api/threads failed", {}, err instanceof Error ? err : new Error(String(err)));
    deps.addLog({
      level: "error",
      source: "api.threads",
      message: "Failed to fetch threads.",
      metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    });
    return NextResponse.json({ error: "Failed to fetch threads." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  log.enter("POST /api/threads");
  const dbState = ensureThreadRouteDbReady();
  if (!dbState.ok) return dbState.response;

  try {
    const auth = await deps.requireUser();
    if ("error" in auth) return auth.error;

    const body = await req.json();
    const thread = deps.createThread(body.title, auth.user.id);
    deps.addLog({
      level: "verbose",
      source: "api.threads",
      message: "Created new thread.",
      metadata: JSON.stringify({ userId: auth.user.id, threadId: thread.id }),
    });
    log.exit("POST /api/threads", { threadId: thread.id }, Date.now() - t0);
    return NextResponse.json(thread, { status: 201 });
  } catch (err) {
    log.error("POST /api/threads failed", {}, err instanceof Error ? err : new Error(String(err)));
    deps.addLog({
      level: "error",
      source: "api.threads",
      message: "Failed to create thread.",
      metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    });
    return NextResponse.json({ error: "Failed to create thread." }, { status: 500 });
  }
}
