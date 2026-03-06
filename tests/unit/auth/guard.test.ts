/**
 * Unit tests — Auth guard functions
 *
 * Validates:
 * - requireUser() authenticates via session or API key
 * - requireUser() rejects unauthenticated/disabled users
 * - requireAdmin() blocks non-admins and API key auth
 * - requireScope() enforces API key scopes
 * - resolveApiKey handles expiry and invalid tokens
 */

// ── Mocks ────────────────────────────────────────────────────────

// Mock bootstrap so it doesn't try to init the real DB
jest.mock("@/lib/bootstrap", () => ({
  bootstrapRuntime: jest.fn(() => Promise.resolve()),
}));

// Mock next-auth
const mockAuth = jest.fn();
jest.mock("@/lib/auth/auth", () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

// Mock next/headers
const mockHeaders = new Map<string, string>();
jest.mock("next/headers", () => ({
  headers: jest.fn(async () => ({
    get: (key: string) => mockHeaders.get(key.toLowerCase()) ?? null,
  })),
}));

// Mock DB functions
const mockGetApiKeyByRawKey = jest.fn();
const mockGetUserById = jest.fn();
const mockIsUserEnabled = jest.fn();
const mockTouchApiKey = jest.fn();

jest.mock("@/lib/db", () => ({
  getApiKeyByRawKey: (...args: unknown[]) => mockGetApiKeyByRawKey(...args),
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  isUserEnabled: (...args: unknown[]) => mockIsUserEnabled(...args),
  touchApiKey: (...args: unknown[]) => mockTouchApiKey(...args),
}));

import {
  requireUser,
  requireAdmin,
  requireScope,
  requireOwner,
  getAuthenticatedUser,
} from "@/lib/auth/guard";

// ── Helpers ──────────────────────────────────────────────────────

function setSessionUser(user: Record<string, unknown> | null) {
  if (user) {
    mockAuth.mockResolvedValue({ user });
  } else {
    mockAuth.mockResolvedValue(null);
  }
}

function setApiKeyHeader(token: string) {
  mockHeaders.set("authorization", `Bearer ${token}`);
}

function clearHeaders() {
  mockHeaders.clear();
}

beforeEach(() => {
  jest.clearAllMocks();
  clearHeaders();
  mockAuth.mockResolvedValue(null);
  mockIsUserEnabled.mockReturnValue(true);
});

// ── Tests ────────────────────────────────────────────────────────

describe("getAuthenticatedUser", () => {
  test("returns user from session", async () => {
    setSessionUser({ id: "user-1", email: "test@test.com", role: "admin" });
    const user = await getAuthenticatedUser();
    expect(user).toEqual({ id: "user-1", email: "test@test.com", role: "admin" });
  });

  test("returns null when no session and no API key", async () => {
    setSessionUser(null);
    const user = await getAuthenticatedUser();
    expect(user).toBeNull();
  });

  test("resolves user from valid API key when no session", async () => {
    setSessionUser(null);
    setApiKeyHeader("nxk_validkey123");
    mockGetApiKeyByRawKey.mockReturnValue({
      id: "key-1",
      user_id: "user-2",
      expires_at: null,
      scopes: '["chat","threads"]',
    });
    mockGetUserById.mockReturnValue({ id: "user-2", email: "api@test.com", role: "user" });
    mockIsUserEnabled.mockReturnValue(true);

    const user = await getAuthenticatedUser();
    expect(user).toEqual({
      id: "user-2",
      email: "api@test.com",
      role: "user",
      apiKeyScopes: ["chat", "threads"],
    });
  });

  test("rejects expired API key", async () => {
    setSessionUser(null);
    setApiKeyHeader("nxk_expiredkey");
    mockGetApiKeyByRawKey.mockReturnValue({
      id: "key-2",
      user_id: "user-3",
      expires_at: "2020-01-01T00:00:00Z", // expired
      scopes: '["chat"]',
    });

    const user = await getAuthenticatedUser();
    expect(user).toBeNull();
  });

  test("rejects API key for disabled user", async () => {
    setSessionUser(null);
    setApiKeyHeader("nxk_disableduser");
    mockGetApiKeyByRawKey.mockReturnValue({
      id: "key-3",
      user_id: "user-4",
      expires_at: null,
      scopes: '["chat"]',
    });
    mockGetUserById.mockReturnValue({ id: "user-4", email: "disabled@test.com", role: "user" });
    mockIsUserEnabled.mockReturnValue(false);

    const user = await getAuthenticatedUser();
    expect(user).toBeNull();
  });

  test("rejects non-nxk_ bearer tokens", async () => {
    setSessionUser(null);
    setApiKeyHeader("sk-someopenaikey");

    const user = await getAuthenticatedUser();
    expect(user).toBeNull();
    expect(mockGetApiKeyByRawKey).not.toHaveBeenCalled();
  });

  test("rejects unknown API key", async () => {
    setSessionUser(null);
    setApiKeyHeader("nxk_unknownkey");
    mockGetApiKeyByRawKey.mockReturnValue(null);

    const user = await getAuthenticatedUser();
    expect(user).toBeNull();
  });
});

describe("requireUser", () => {
  test("returns user for valid session", async () => {
    setSessionUser({ id: "user-1", email: "test@test.com", role: "admin" });
    const result = await requireUser();
    expect("user" in result).toBe(true);
    if ("user" in result) {
      expect(result.user.id).toBe("user-1");
    }
  });

  test("returns 401 for unauthenticated request", async () => {
    setSessionUser(null);
    const result = await requireUser();
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe(401);
    }
  });

  test("returns 403 for disabled user", async () => {
    setSessionUser({ id: "user-disabled", email: "d@test.com", role: "user" });
    mockIsUserEnabled.mockReturnValue(false);
    const result = await requireUser();
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe(403);
    }
  });
});

describe("requireAdmin", () => {
  test("passes for session-based admin", async () => {
    setSessionUser({ id: "admin-1", email: "admin@test.com", role: "admin" });
    const result = await requireAdmin();
    expect("user" in result).toBe(true);
  });

  test("rejects non-admin role", async () => {
    setSessionUser({ id: "user-1", email: "user@test.com", role: "user" });
    const result = await requireAdmin();
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe(403);
    }
  });

  test("rejects API key auth even with admin role", async () => {
    setSessionUser(null);
    setApiKeyHeader("nxk_adminkey");
    mockGetApiKeyByRawKey.mockReturnValue({
      id: "key-admin",
      user_id: "admin-2",
      expires_at: null,
      scopes: '["chat","admin"]',
    });
    mockGetUserById.mockReturnValue({ id: "admin-2", email: "admin2@test.com", role: "admin" });
    mockIsUserEnabled.mockReturnValue(true);

    const result = await requireAdmin();
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe(403);
      const body = await result.error.json();
      expect(body.error).toContain("session authentication");
    }
  });

  test("returns 401 for unauthenticated", async () => {
    setSessionUser(null);
    const result = await requireAdmin();
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe(401);
    }
  });
});

describe("requireScope", () => {
  test("session user passes any scope check", async () => {
    setSessionUser({ id: "user-1", email: "user@test.com", role: "user" });
    const result = await requireScope("chat");
    expect("user" in result).toBe(true);
  });

  test("API key with matching scope passes", async () => {
    setSessionUser(null);
    setApiKeyHeader("nxk_scopedkey");
    mockGetApiKeyByRawKey.mockReturnValue({
      id: "key-scoped",
      user_id: "user-5",
      expires_at: null,
      scopes: '["chat","threads"]',
    });
    mockGetUserById.mockReturnValue({ id: "user-5", email: "scoped@test.com", role: "user" });
    mockIsUserEnabled.mockReturnValue(true);

    const result = await requireScope("chat");
    expect("user" in result).toBe(true);
  });

  test("API key without required scope gets 403", async () => {
    setSessionUser(null);
    setApiKeyHeader("nxk_limitedkey");
    mockGetApiKeyByRawKey.mockReturnValue({
      id: "key-limited",
      user_id: "user-6",
      expires_at: null,
      scopes: '["threads"]',
    });
    mockGetUserById.mockReturnValue({ id: "user-6", email: "limited@test.com", role: "user" });
    mockIsUserEnabled.mockReturnValue(true);

    const result = await requireScope("chat");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe(403);
      const body = await result.error.json();
      expect(body.error).toContain("missing required scope");
    }
  });
});

describe("requireOwner", () => {
  test("returns null (no error) for authenticated user", async () => {
    setSessionUser({ id: "user-1", email: "owner@test.com", role: "admin" });
    const result = await requireOwner();
    expect(result).toBeNull();
  });

  test("returns 401 response for unauthenticated", async () => {
    setSessionUser(null);
    const result = await requireOwner();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });
});
