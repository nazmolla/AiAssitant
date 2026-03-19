/**
 * Unit tests for GET /api/logs and DELETE /api/logs routes.
 *
 * Verifies the DI seam: the route imports from @/lib/db/log-queries (granular
 * module), not the barrel, so each concern can be mocked independently.
 */

// ── Mocks ────────────────────────────────────────────────────────────

const mockRequireUser = jest.fn();
const mockRequireAdmin = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireUser: () => mockRequireUser(),
  requireAdmin: () => mockRequireAdmin(),
}));

const mockGetRecentLogs = jest.fn(() => []);
const mockDeleteAllLogs = jest.fn(() => 0);
const mockDeleteLogsByLevel = jest.fn(() => 0);
const mockDeleteLogsOlderThanDays = jest.fn(() => 0);
const mockAddLog = jest.fn();

jest.mock("@/lib/db/log-queries", () => ({
  getRecentLogs: (...args: unknown[]) => mockGetRecentLogs(...args),
  deleteAllLogs: () => mockDeleteAllLogs(),
  deleteLogsByLevel: (...args: unknown[]) => mockDeleteLogsByLevel(...args),
  deleteLogsOlderThanDays: (...args: unknown[]) => mockDeleteLogsOlderThanDays(...args),
  addLog: (...args: unknown[]) => mockAddLog(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────

function makeAdminUser() {
  return { user: { id: "admin-1", role: "admin", apiKeyScopes: undefined } };
}

function makeApiKeyUser(scopes: string[]) {
  return { user: { id: "user-1", role: "user", apiKeyScopes: scopes } };
}

function makeRequest(
  method: string,
  url: string,
  body?: unknown
): Request {
  return new Request(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("GET /api/logs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue(makeAdminUser());
  });

  test("returns log array from getRecentLogs", async () => {
    const fakeLogs = [{ id: 1, level: "info", message: "test" }];
    mockGetRecentLogs.mockReturnValue(fakeLogs);

    const { GET } = await import("@/app/api/logs/route");
    const req = makeRequest("GET", "http://localhost/api/logs?limit=10&level=all&source=all");
    const res = await GET(req as Parameters<typeof GET>[0]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(fakeLogs);
    expect(mockGetRecentLogs).toHaveBeenCalledTimes(1);
  });

  test("returns 403 for unauthenticated user (no session)", async () => {
    mockRequireUser.mockResolvedValue({ error: Response.json({ error: "Unauthorized" }, { status: 401 }) });

    const { GET } = await import("@/app/api/logs/route");
    const req = makeRequest("GET", "http://localhost/api/logs");
    const res = await GET(req as Parameters<typeof GET>[0]);

    expect(res.status).toBe(401);
    expect(mockGetRecentLogs).not.toHaveBeenCalled();
  });

  test("returns 403 for API key user without logs scope", async () => {
    mockRequireUser.mockResolvedValue(makeApiKeyUser(["chat"]));

    const { GET } = await import("@/app/api/logs/route");
    const req = makeRequest("GET", "http://localhost/api/logs");
    const res = await GET(req as Parameters<typeof GET>[0]);

    expect(res.status).toBe(403);
  });

  test("allows API key user with logs scope", async () => {
    mockRequireUser.mockResolvedValue(makeApiKeyUser(["logs"]));

    const { GET } = await import("@/app/api/logs/route");
    const req = makeRequest("GET", "http://localhost/api/logs");
    const res = await GET(req as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/logs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(makeAdminUser());
  });

  test("mode=all deletes all logs", async () => {
    mockDeleteAllLogs.mockReturnValue(42);

    const { DELETE } = await import("@/app/api/logs/route");
    const req = makeRequest("DELETE", "http://localhost/api/logs", { mode: "all" });
    const res = await DELETE(req as Parameters<typeof DELETE>[0]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, deleted: 42 });
    expect(mockDeleteAllLogs).toHaveBeenCalledTimes(1);
  });

  test("mode=level deletes logs by level", async () => {
    mockDeleteLogsByLevel.mockReturnValue(5);

    const { DELETE } = await import("@/app/api/logs/route");
    const req = makeRequest("DELETE", "http://localhost/api/logs", { mode: "level", level: "verbose" });
    const res = await DELETE(req as Parameters<typeof DELETE>[0]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, deleted: 5 });
  });

  test("mode=level with invalid level returns 400", async () => {
    const { DELETE } = await import("@/app/api/logs/route");
    const req = makeRequest("DELETE", "http://localhost/api/logs", { mode: "level", level: "INVALID" });
    const res = await DELETE(req as Parameters<typeof DELETE>[0]);

    expect(res.status).toBe(400);
    expect(mockDeleteLogsByLevel).not.toHaveBeenCalled();
  });

  test("mode=older-than-days deletes old logs", async () => {
    mockDeleteLogsOlderThanDays.mockReturnValue(10);

    const { DELETE } = await import("@/app/api/logs/route");
    const req = makeRequest("DELETE", "http://localhost/api/logs", { mode: "older-than-days", days: 30 });
    const res = await DELETE(req as Parameters<typeof DELETE>[0]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, deleted: 10 });
  });

  test("mode=older-than-days with invalid days returns 400", async () => {
    const { DELETE } = await import("@/app/api/logs/route");
    const req = makeRequest("DELETE", "http://localhost/api/logs", { mode: "older-than-days", days: -5 });
    const res = await DELETE(req as Parameters<typeof DELETE>[0]);

    expect(res.status).toBe(400);
  });

  test("invalid mode returns 400", async () => {
    const { DELETE } = await import("@/app/api/logs/route");
    const req = makeRequest("DELETE", "http://localhost/api/logs", { mode: "unknown" });
    const res = await DELETE(req as Parameters<typeof DELETE>[0]);

    expect(res.status).toBe(400);
  });

  test("returns 403 for non-admin user", async () => {
    mockRequireAdmin.mockResolvedValue({ error: Response.json({ error: "Forbidden" }, { status: 403 }) });

    const { DELETE } = await import("@/app/api/logs/route");
    const req = makeRequest("DELETE", "http://localhost/api/logs", { mode: "all" });
    const res = await DELETE(req as Parameters<typeof DELETE>[0]);

    expect(res.status).toBe(403);
    expect(mockDeleteAllLogs).not.toHaveBeenCalled();
  });
});
