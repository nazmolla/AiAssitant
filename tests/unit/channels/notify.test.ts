/**
 * Unit tests — Notification dispatch (notifyAdmin)
 *
 * Validates:
 * - normalizeNotificationLevel() handles edge cases
 * - shouldNotifyForLevel() correctly filters by threshold
 * - notifyAdmin() dispatches via IM/email/in-app
 * - notifyAdmin() suppresses below-threshold events
 */

// ── Mocks ────────────────────────────────────────────────────────

const mockListUsersWithPermissions = jest.fn();
const mockListChannels = jest.fn();
const mockListChannelUserMappings = jest.fn();
const mockAddLog = jest.fn();
const mockGetUserProfile = jest.fn();
const mockGetUserById = jest.fn();
const mockCreateNotification = jest.fn();

jest.mock("@/lib/db", () => ({
  listUsersWithPermissions: (...a: unknown[]) => mockListUsersWithPermissions(...a),
  listChannels: (...a: unknown[]) => mockListChannels(...a),
  listChannelUserMappings: (...a: unknown[]) => mockListChannelUserMappings(...a),
  addLog: (...a: unknown[]) => mockAddLog(...a),
  getUserProfile: (...a: unknown[]) => mockGetUserProfile(...a),
  getUserById: (...a: unknown[]) => mockGetUserById(...a),
  createNotification: (...a: unknown[]) => mockCreateNotification(...a),
}));

const mockSendDiscordDm = jest.fn();
jest.mock("@/lib/channels/discord", () => ({
  sendDiscordDirectMessage: (...a: unknown[]) => mockSendDiscordDm(...a),
}));

const mockSendSmtpMail = jest.fn();
jest.mock("@/lib/channels/email-transport", () => ({
  buildThemedEmailBody: jest.fn(() => ({ text: "plain", html: "<p>html</p>" })),
  getEmailChannelConfig: jest.fn(() => ({
    smtpHost: "smtp.test.com",
    smtpPort: 587,
    smtpUser: "user",
    smtpPass: "pass",
    fromAddress: "nexus@test.com",
  })),
  isValidPort: jest.fn(() => true),
  sendSmtpMail: (...a: unknown[]) => mockSendSmtpMail(...a),
}));

import { notifyAdmin, getUserNotificationLevel } from "@/lib/channels/notify";

beforeEach(() => {
  jest.clearAllMocks();
  // Default: admin exists, enabled, disaster threshold
  mockListUsersWithPermissions.mockReturnValue([
    { id: "admin-1", email: "admin@test.com", role: "admin", enabled: 1 },
  ]);
  mockGetUserById.mockReturnValue({ id: "admin-1", email: "admin@test.com", role: "admin" });
  mockGetUserProfile.mockReturnValue(null); // defaults to disaster threshold
  mockListChannels.mockReturnValue([]);
  mockListChannelUserMappings.mockReturnValue([]);
});

// ── Tests ────────────────────────────────────────────────────────

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

describe("notifyAdmin", () => {
  test("returns false when no admins exist", async () => {
    mockListUsersWithPermissions.mockReturnValue([]);
    const result = await notifyAdmin("test message");
    expect(result).toBe(false);
  });

  test("creates in-app notification", async () => {
    mockGetUserProfile.mockReturnValue({ notification_level: "low" });
    await notifyAdmin("Alert!", "Test", { level: "disaster" });
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-1",
        title: "Test",
        body: "Alert!",
      })
    );
  });

  test("suppresses notification when below user threshold", async () => {
    // User threshold is disaster-only, event is low
    mockGetUserProfile.mockReturnValue({ notification_level: "disaster" });
    const result = await notifyAdmin("Low priority", "Test", { level: "low" });
    expect(result).toBe(false);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  test("dispatches via Discord when IM channel is available", async () => {
    mockGetUserProfile.mockReturnValue({ notification_level: "low" });
    mockListChannels.mockReturnValue([
      { id: "ch-1", channel_type: "discord", enabled: 1, config_json: "{}" },
    ]);
    mockListChannelUserMappings.mockReturnValue([
      { user_id: "admin-1", external_id: "discord-user-123" },
    ]);
    mockSendDiscordDm.mockResolvedValue(undefined);

    const result = await notifyAdmin("Alert!", "Test", { level: "high" });
    expect(result).toBe(true);
    expect(mockSendDiscordDm).toHaveBeenCalledWith("ch-1", "discord-user-123", "Alert!");
  });

  test("falls back to email when no IM channels", async () => {
    mockGetUserProfile.mockReturnValue({ notification_level: "low" });
    mockListChannels.mockReturnValue([
      { id: "ch-email", channel_type: "email", enabled: 1, config_json: "{}" },
    ]);
    mockSendSmtpMail.mockResolvedValue(undefined);

    const result = await notifyAdmin("Alert!", "Test Subject", { level: "high" });
    expect(result).toBe(true);
    expect(mockSendSmtpMail).toHaveBeenCalled();
  });

  test("notifies specific user when userId provided", async () => {
    mockGetUserById.mockReturnValue({ id: "user-5", email: "user5@test.com" });
    mockGetUserProfile.mockReturnValue({ notification_level: "low" });
    mockListChannels.mockReturnValue([
      { id: "ch-email", channel_type: "email", enabled: 1, config_json: "{}" },
    ]);
    mockSendSmtpMail.mockResolvedValue(undefined);

    const result = await notifyAdmin("Direct message", "Test", {
      level: "medium",
      userId: "user-5",
    });
    expect(result).toBe(true);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-5" })
    );
  });
});
