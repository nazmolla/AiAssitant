/**
 * Unit tests — App-level notifications (src/lib/notifications.ts)
 *
 * Validates:
 * - normalizeNotificationLevel() edge cases
 * - shouldNotifyForLevel() threshold filtering (4×4 matrix)
 * - notify() ALWAYS creates in-app notification regardless of threshold
 * - notify() gates channel delivery by threshold
 * - notify() resolves target user (specific / admin fallback)
 */

// ── Mocks ────────────────────────────────────────────────────────

const mockListUsersWithPermissions = jest.fn();
const mockAddLog = jest.fn();
const mockGetUserProfile = jest.fn();
const mockGetUserById = jest.fn();
const mockCreateNotification = jest.fn();

jest.mock("@/lib/db", () => ({
  listUsersWithPermissions: (...a: unknown[]) => mockListUsersWithPermissions(...a),
  addLog: (...a: unknown[]) => mockAddLog(...a),
  getUserProfile: (...a: unknown[]) => mockGetUserProfile(...a),
  getUserById: (...a: unknown[]) => mockGetUserById(...a),
  createNotification: (...a: unknown[]) => mockCreateNotification(...a),
}));

const mockSendChannelNotification = jest.fn();
jest.mock("@/lib/channels/notify", () => ({
  sendChannelNotification: (...a: unknown[]) => mockSendChannelNotification(...a),
}));

import {
  notify,
  notifyAdmin,
  getUserNotificationLevel,
  normalizeNotificationLevel,
  shouldNotifyForLevel,
} from "@/lib/notifications";

beforeEach(() => {
  jest.clearAllMocks();
  mockListUsersWithPermissions.mockReturnValue([
    { id: "admin-1", email: "admin@test.com", role: "admin", enabled: 1 },
  ]);
  mockGetUserById.mockReturnValue({ id: "admin-1", email: "admin@test.com", role: "admin" });
  mockGetUserProfile.mockReturnValue(null);
  mockSendChannelNotification.mockResolvedValue(true);
});

// ── normalizeNotificationLevel ───────────────────────────────────

describe("normalizeNotificationLevel", () => {
  test("returns disaster for null/undefined", () => {
    expect(normalizeNotificationLevel(null)).toBe("disaster");
    expect(normalizeNotificationLevel(undefined)).toBe("disaster");
  });

  test("returns disaster for non-string values", () => {
    expect(normalizeNotificationLevel(42)).toBe("disaster");
    expect(normalizeNotificationLevel({})).toBe("disaster");
    expect(normalizeNotificationLevel(true)).toBe("disaster");
  });

  test("returns disaster for invalid strings", () => {
    expect(normalizeNotificationLevel("garbage")).toBe("disaster");
    expect(normalizeNotificationLevel("")).toBe("disaster");
    expect(normalizeNotificationLevel("  ")).toBe("disaster");
  });

  test("normalizes valid levels case-insensitively", () => {
    expect(normalizeNotificationLevel("LOW")).toBe("low");
    expect(normalizeNotificationLevel("Medium")).toBe("medium");
    expect(normalizeNotificationLevel("  HIGH  ")).toBe("high");
    expect(normalizeNotificationLevel("DISASTER")).toBe("disaster");
  });

  test("passes through valid lowercase levels", () => {
    expect(normalizeNotificationLevel("low")).toBe("low");
    expect(normalizeNotificationLevel("medium")).toBe("medium");
    expect(normalizeNotificationLevel("high")).toBe("high");
    expect(normalizeNotificationLevel("disaster")).toBe("disaster");
  });
});

// ── shouldNotifyForLevel (4×4 matrix) ────────────────────────────

describe("shouldNotifyForLevel", () => {
  // disaster = 0, high = 1, medium = 2, low = 3
  // rule: eventIndex <= thresholdIndex

  test("disaster threshold allows only disaster events", () => {
    expect(shouldNotifyForLevel("disaster", "disaster")).toBe(true);
    expect(shouldNotifyForLevel("disaster", "high")).toBe(false);
    expect(shouldNotifyForLevel("disaster", "medium")).toBe(false);
    expect(shouldNotifyForLevel("disaster", "low")).toBe(false);
  });

  test("high threshold allows disaster and high", () => {
    expect(shouldNotifyForLevel("high", "disaster")).toBe(true);
    expect(shouldNotifyForLevel("high", "high")).toBe(true);
    expect(shouldNotifyForLevel("high", "medium")).toBe(false);
    expect(shouldNotifyForLevel("high", "low")).toBe(false);
  });

  test("medium threshold allows disaster, high, and medium", () => {
    expect(shouldNotifyForLevel("medium", "disaster")).toBe(true);
    expect(shouldNotifyForLevel("medium", "high")).toBe(true);
    expect(shouldNotifyForLevel("medium", "medium")).toBe(true);
    expect(shouldNotifyForLevel("medium", "low")).toBe(false);
  });

  test("low threshold allows all events", () => {
    expect(shouldNotifyForLevel("low", "disaster")).toBe(true);
    expect(shouldNotifyForLevel("low", "high")).toBe(true);
    expect(shouldNotifyForLevel("low", "medium")).toBe(true);
    expect(shouldNotifyForLevel("low", "low")).toBe(true);
  });

  test("invalid threshold falls back to disaster-only", () => {
    expect(shouldNotifyForLevel("invalid" as "disaster", "disaster")).toBe(true);
    expect(shouldNotifyForLevel("invalid" as "disaster", "high")).toBe(false);
  });
});

// ── getUserNotificationLevel ─────────────────────────────────────

describe("getUserNotificationLevel", () => {
  test("defaults to disaster when no profile", () => {
    mockGetUserProfile.mockReturnValue(null);
    expect(getUserNotificationLevel("user-1")).toBe("disaster");
  });

  test("reads level from profile", () => {
    mockGetUserProfile.mockReturnValue({ notification_level: "low" });
    expect(getUserNotificationLevel("user-1")).toBe("low");
  });

  test("normalizes invalid values to disaster", () => {
    mockGetUserProfile.mockReturnValue({ notification_level: "garbage" });
    expect(getUserNotificationLevel("user-1")).toBe("disaster");
  });
});

// ── notify() ─────────────────────────────────────────────────────

describe("notify", () => {
  test("returns false when no admins exist", async () => {
    mockListUsersWithPermissions.mockReturnValue([]);
    const result = await notify("test message");
    expect(result).toBe(false);
    // In-app notification should NOT be created when no user resolved
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  test("ALWAYS creates in-app notification regardless of threshold", async () => {
    // threshold=disaster, event=low → channel suppressed, but in-app created
    mockGetUserProfile.mockReturnValue({ notification_level: "disaster" });
    const result = await notify("Low priority", "Test", { level: "low" });
    expect(result).toBe(false); // channel suppressed
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-1",
        title: "Test",
        body: "Low priority",
        type: "info",
      })
    );
    // Channel delivery should NOT have been called
    expect(mockSendChannelNotification).not.toHaveBeenCalled();
  });

  test("creates in-app AND dispatches channel when threshold met", async () => {
    mockGetUserProfile.mockReturnValue({ notification_level: "low" });
    const result = await notify("Alert!", "Test", { level: "high" });
    expect(result).toBe(true);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-1",
        title: "Test",
        body: "Alert!",
        type: "system_error", // high level → system_error
      })
    );
    expect(mockSendChannelNotification).toHaveBeenCalledWith(
      "admin-1", "admin@test.com", "Alert!", "Test"
    );
  });

  test("maps disaster/high to system_error type", async () => {
    mockGetUserProfile.mockReturnValue({ notification_level: "low" });
    await notify("msg", "subj", { level: "disaster" });
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "system_error" })
    );
  });

  test("maps medium/low to info type", async () => {
    mockGetUserProfile.mockReturnValue({ notification_level: "low" });
    await notify("msg", "subj", { level: "medium" });
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "info" })
    );
  });

  test("respects explicit notificationType option", async () => {
    mockGetUserProfile.mockReturnValue({ notification_level: "low" });
    await notify("msg", "subj", { level: "medium", notificationType: "approval_required" });
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "approval_required" })
    );
  });

  test("notifies specific user when userId provided", async () => {
    mockGetUserById.mockReturnValue({ id: "user-5", email: "user5@test.com" });
    mockGetUserProfile.mockReturnValue({ notification_level: "low" });

    const result = await notify("Direct message", "Test", {
      level: "medium",
      userId: "user-5",
    });
    expect(result).toBe(true);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-5" })
    );
    expect(mockSendChannelNotification).toHaveBeenCalledWith(
      "user-5", "user5@test.com", "Direct message", "Test"
    );
  });

  test("logs suppression when channel delivery is gated", async () => {
    mockGetUserProfile.mockReturnValue({ notification_level: "disaster" });
    await notify("Low priority", "Test", { level: "low" });
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "notifications",
        message: expect.stringContaining("Channel delivery suppressed"),
      })
    );
  });

  test("notifyAdmin is an alias for notify", () => {
    expect(notifyAdmin).toBe(notify);
  });
});
