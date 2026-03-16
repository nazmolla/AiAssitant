/**
 * Unit tests — Channel delivery (sendChannelNotification)
 *
 * Validates:
 * - sendChannelNotification() dispatches via IM/email
 * - Backward-compatible re-exports from channels/notify
 *
 * Note: Notification lifecycle tests (in-app creation, threshold logic)
 * are in tests/unit/notifications.test.ts.
 */

// ── Mocks ────────────────────────────────────────────────────────

const mockListChannels = jest.fn();
const mockListChannelUserMappings = jest.fn();
const mockAddLog = jest.fn();

jest.mock("@/lib/db", () => ({
  listChannels: (...a: unknown[]) => mockListChannels(...a),
  listChannelUserMappings: (...a: unknown[]) => mockListChannelUserMappings(...a),
  addLog: (...a: unknown[]) => mockAddLog(...a),
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

// Mock @/lib/notifications to prevent circular dependency in tests
jest.mock("@/lib/notifications", () => ({
  notify: jest.fn(),
  notifyAdmin: jest.fn(),
  getUserNotificationLevel: jest.fn(() => "disaster"),
  shouldNotifyForLevel: jest.fn(() => true),
  normalizeNotificationLevel: jest.fn((v: unknown) => typeof v === "string" ? v : "disaster"),
}));

import { sendChannelNotification } from "@/lib/channels/notify";

beforeEach(() => {
  jest.clearAllMocks();
  mockListChannels.mockReturnValue([]);
  mockListChannelUserMappings.mockReturnValue([]);
});

// ── Tests ────────────────────────────────────────────────────────

describe("sendChannelNotification", () => {
  test("returns false when no channels configured", async () => {
    mockListChannels.mockReturnValue([]);
    const result = await sendChannelNotification("user-1", "user@test.com", "msg", "subj");
    expect(result).toBe(false);
  });

  test("dispatches via Discord when IM channel is available", async () => {
    mockListChannels.mockReturnValue([
      { id: "ch-1", channel_type: "discord", enabled: 1, config_json: "{}" },
    ]);
    mockListChannelUserMappings.mockReturnValue([
      { user_id: "admin-1", external_id: "discord-user-123" },
    ]);
    mockSendDiscordDm.mockResolvedValue(undefined);

    const result = await sendChannelNotification("admin-1", "admin@test.com", "Alert!", "Test");
    expect(result).toBe(true);
    expect(mockSendDiscordDm).toHaveBeenCalledWith("ch-1", "discord-user-123", "Alert!");
  });

  test("falls back to email when no IM channels", async () => {
    mockListChannels.mockReturnValue([
      { id: "ch-email", channel_type: "email", enabled: 1, config_json: "{}" },
    ]);
    mockSendSmtpMail.mockResolvedValue(undefined);

    const result = await sendChannelNotification("admin-1", "admin@test.com", "Alert!", "Test Subject");
    expect(result).toBe(true);
    expect(mockSendSmtpMail).toHaveBeenCalled();
  });

  test("skips disabled channels", async () => {
    mockListChannels.mockReturnValue([
      { id: "ch-1", channel_type: "discord", enabled: 0, config_json: "{}" },
    ]);
    const result = await sendChannelNotification("admin-1", "admin@test.com", "msg", "subj");
    expect(result).toBe(false);
  });

  test("logs warning on IM send failure and continues to email", async () => {
    mockListChannels.mockReturnValue([
      { id: "ch-im", channel_type: "discord", enabled: 1, config_json: "{}" },
      { id: "ch-email", channel_type: "email", enabled: 1, config_json: "{}" },
    ]);
    mockListChannelUserMappings.mockReturnValue([
      { user_id: "admin-1", external_id: "discord-user-123" },
    ]);
    mockSendDiscordDm.mockRejectedValue(new Error("Discord API down"));
    mockSendSmtpMail.mockResolvedValue(undefined);

    const result = await sendChannelNotification("admin-1", "admin@test.com", "msg", "subj");
    expect(result).toBe(true);
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: expect.stringContaining("Failed channel notification via discord"),
      })
    );
    expect(mockSendSmtpMail).toHaveBeenCalled();
  });

  test("returns false when email is empty", async () => {
    mockListChannels.mockReturnValue([
      { id: "ch-email", channel_type: "email", enabled: 1, config_json: "{}" },
    ]);
    const result = await sendChannelNotification("admin-1", "", "msg", "subj");
    expect(result).toBe(false);
  });
});

describe("backward-compatible re-exports", () => {
  test("notifyAdmin and notify are re-exported", async () => {
    const mod = await import("@/lib/channels/notify");
    expect(mod.notifyAdmin).toBeDefined();
    expect(mod.notify).toBeDefined();
    expect(mod.getUserNotificationLevel).toBeDefined();
  });
});
