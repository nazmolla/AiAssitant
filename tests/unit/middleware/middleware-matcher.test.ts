/**
 * Unit tests — Middleware matcher configuration
 *
 * Verifies that all API routes requiring authentication are included
 * in the Next.js middleware matcher. Routes not in the matcher bypass
 * middleware entirely (no rate-limiting or JWT checks).
 */

// Mock ESM-only modules that Jest can't import
jest.mock("next-auth/jwt", () => ({ getToken: jest.fn() }));
jest.mock("next/server", () => ({
  NextResponse: { json: jest.fn(), redirect: jest.fn(), next: jest.fn() },
}));

import { config } from "@/middleware";

describe("Middleware Matcher Config", () => {
  const matcher = config.matcher;

  // All route prefixes that must be in the middleware matcher
  const requiredPrefixes = [
    "/api/threads",
    "/api/approvals",
    "/api/knowledge",
    "/api/mcp",
    "/api/policies",
    "/api/logs",
    "/api/config",
    "/api/attachments",
    "/api/admin",
    "/api/audio",
    "/api/conversation",
    "/api/channels",  // rate-limited here; webhook sub-paths bypass JWT via middleware
  ];

  // Exact routes (no wildcard)
  const requiredExact = [
    "/api/notifications",
    "/api/notifications/stream", // rate-limited; auth bypass allows unauthenticated SSE
    "/api/client-error",         // rate-limited; auth bypass allows unauthenticated error reporting
  ];

  // Routes intentionally NOT in the matcher
  const excludedRoutes = [
    "/api/auth", // NextAuth handles its own auth
  ];

  test.each(requiredPrefixes)(
    "includes %s/:path* in matcher",
    (prefix) => {
      const pattern = `${prefix}/:path*`;
      expect(matcher).toContain(pattern);
    }
  );

  test.each(requiredExact)(
    "includes exact route %s in matcher",
    (route) => {
      expect(matcher).toContain(route);
    }
  );

  test.each(excludedRoutes)(
    "does NOT include %s in matcher (uses own auth)",
    (route) => {
      const hasMatch = matcher.some(
        (m: string) => m === route || m.startsWith(`${route}/`) || m.startsWith(`${route}:`)
      );
      expect(hasMatch).toBe(false);
    }
  );

  test("matcher has expected number of entries", () => {
    // 12 wildcard prefix routes + 3 exact routes = 15
    expect(matcher).toHaveLength(requiredPrefixes.length + requiredExact.length);
  });
});
