/**
 * Unit tests for src/middleware.ts
 *
 * Tests each middleware concern independently:
 *  - Rate limiting (applyRateLimit)
 *  - Auth bypass (checkAuthBypass)
 *  - Auth gating (gateAuth)
 *  - Composed pipeline (middleware)
 */

import { NextRequest } from "next/server";

// Mock next-auth/jwt before importing middleware
jest.mock("next-auth/jwt", () => ({
  getToken: jest.fn(),
}));

import { getToken } from "next-auth/jwt";
import { applyRateLimit, checkAuthBypass, gateAuth, middleware } from "@/middleware";

const mockGetToken = getToken as jest.MockedFunction<typeof getToken>;

function makeRequest(
  path: string,
  options?: { ip?: string; authorization?: string }
): NextRequest {
  const url = `http://localhost:3000${path}`;
  const headers = new Headers();
  if (options?.ip) {
    // Use x-real-ip — middleware prefers req.ip then x-real-ip over x-forwarded-for
    headers.set("x-real-ip", options.ip);
  }
  if (options?.authorization) {
    headers.set("authorization", options.authorization);
  }
  return new NextRequest(url, { headers });
}

describe("applyRateLimit", () => {
  test("allows requests under the limit", () => {
    const req = makeRequest("/api/threads", { ip: "10.0.0.1" });
    const result = applyRateLimit(req);
    expect(result).toBeNull();
  });

  test("returns 429 when rate limit exceeded", () => {
    const ip = "10.0.0.99";
    // Exhaust the rate limit (120 requests)
    for (let i = 0; i < 120; i++) {
      applyRateLimit(makeRequest("/api/threads", { ip }));
    }
    // 121st request should be rate limited
    const result = applyRateLimit(makeRequest("/api/threads", { ip }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  test("uses 'unknown' when no IP header present", () => {
    const req = makeRequest("/api/threads");
    const result = applyRateLimit(req);
    expect(result).toBeNull();
  });
});

describe("checkAuthBypass", () => {
  test("bypasses auth for API key bearer tokens", () => {
    const req = makeRequest("/api/threads", {
      authorization: "Bearer nxk_abc123",
    });
    const result = checkAuthBypass(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(200);
  });

  test("bypasses auth for channel webhook routes", () => {
    const req = makeRequest("/api/channels/discord/webhook");
    const result = checkAuthBypass(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(200);
  });

  test("bypasses auth for webhook routes with trailing slash", () => {
    const req = makeRequest("/api/channels/slack/webhook/");
    const result = checkAuthBypass(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(200);
  });

  test("does not bypass for regular API routes", () => {
    const req = makeRequest("/api/threads");
    const result = checkAuthBypass(req);
    expect(result).toBeNull();
  });

  test("does not bypass for non-nxk bearer tokens", () => {
    const req = makeRequest("/api/threads", {
      authorization: "Bearer regular_token_123",
    });
    const result = checkAuthBypass(req);
    expect(result).toBeNull();
  });

  test("does not bypass for webhook sub-paths", () => {
    const req = makeRequest("/api/channels/discord/webhook/extra");
    const result = checkAuthBypass(req);
    expect(result).toBeNull();
  });
});

describe("gateAuth", () => {
  afterEach(() => {
    mockGetToken.mockReset();
  });

  test("allows authenticated requests", async () => {
    mockGetToken.mockResolvedValue({ userId: "user-1" } as any);
    const req = makeRequest("/api/threads");
    const result = await gateAuth(req);
    expect(result).toBeNull();
  });

  test("returns 401 for unauthenticated API requests", async () => {
    mockGetToken.mockResolvedValue(null);
    const req = makeRequest("/api/threads");
    const result = await gateAuth(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  test("returns 401 when token has no userId", async () => {
    mockGetToken.mockResolvedValue({} as any);
    const req = makeRequest("/api/threads");
    const result = await gateAuth(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  test("redirects to signin for unauthenticated page requests", async () => {
    mockGetToken.mockResolvedValue(null);
    const req = makeRequest("/dashboard");
    const result = await gateAuth(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(307); // Next.js redirect
    expect(result!.headers.get("location")).toContain("/auth/signin");
  });
});

describe("middleware (composed pipeline)", () => {
  afterEach(() => {
    mockGetToken.mockReset();
  });

  test("allows authenticated request through full pipeline", async () => {
    mockGetToken.mockResolvedValue({ userId: "user-1" } as any);
    const req = makeRequest("/api/threads", { ip: "10.0.0.200" });
    const result = await middleware(req);
    expect(result.status).toBe(200);
  });

  test("API key requests bypass auth gating", async () => {
    // Should not even call getToken
    const req = makeRequest("/api/threads", {
      ip: "10.0.0.201",
      authorization: "Bearer nxk_test_key",
    });
    const result = await middleware(req);
    expect(result.status).toBe(200);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  test("webhook requests bypass auth gating", async () => {
    const req = makeRequest("/api/channels/discord/webhook", { ip: "10.0.0.202" });
    const result = await middleware(req);
    expect(result.status).toBe(200);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  test("unauthenticated API request returns 401", async () => {
    mockGetToken.mockResolvedValue(null);
    const req = makeRequest("/api/threads", { ip: "10.0.0.203" });
    const result = await middleware(req);
    expect(result.status).toBe(401);
  });
});
