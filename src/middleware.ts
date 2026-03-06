import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Rate-limiter: simple sliding-window counter per IP.
 * Limits each IP to MAX_REQUESTS within WINDOW_MS.
 */
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 120; // 120 req/min per IP
const ipHits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    // PERF-14: Evict oldest entries if map exceeds cap
    if (ipHits.size >= IP_HITS_MAX_SIZE) {
      const firstKey = ipHits.keys().next().value;
      if (firstKey) ipHits.delete(firstKey);
    }
    ipHits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_REQUESTS;
}

// PERF-14: Clean stale entries every 60s (was 5 min) + cap map size
const IP_HITS_MAX_SIZE = 10_000;
setInterval(() => {
  const now = Date.now();
  ipHits.forEach((entry, ip) => {
    if (now > entry.resetAt) ipHits.delete(ip);
  });
}, 60_000);

export async function middleware(req: NextRequest) {
  // --- Rate limiting (applied to all matched routes) ---
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // --- API-key bearer tokens bypass session auth ---
  // Requests carrying `Authorization: Bearer nxk_...` are validated later
  // in the route-level guards (guard.ts) — let them through here.
  const authHeader = req.headers.get("authorization") ?? "";
  const isApiKeyRequest = authHeader.toLowerCase().startsWith("bearer nxk_");

  if (isApiKeyRequest) {
    return NextResponse.next();
  }

  // --- Check auth via JWT token (Edge-compatible, no DB access needed) ---
  const isApiRoute = req.nextUrl.pathname.startsWith("/api/");

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const userId = (token as Record<string, unknown> | null)?.userId;

  if (!token || !userId) {
    if (isApiRoute) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL("/auth/signin", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/threads/:path*",
    "/api/approvals/:path*",
    "/api/knowledge/:path*",
    "/api/mcp/:path*",
    "/api/policies/:path*",
    "/api/logs/:path*",
    "/api/config/:path*",
    "/api/attachments/:path*",
    "/api/admin/:path*",
    "/api/audio/:path*",
    "/api/conversation/:path*",
    "/api/notifications",
  ],
};
