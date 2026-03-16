const mockSendDiscordDm = jest.fn();
const mockBuildThemedEmailBody = jest.fn();
const mockGetEmailChannelConfig = jest.fn();
const mockIsValidPort = jest.fn();
const mockSendSmtpMail = jest.fn();

jest.mock("@/lib/channels/discord-channel", () => {
  const actual = jest.requireActual("@/lib/channels/discord-channel");
  return {
    ...actual,
    sendDiscordChannelDirectMessage: (...a: unknown[]) => mockSendDiscordDm(...a),
  };
});

jest.mock("@/lib/services/email-service-client", () => {
  const actual = jest.requireActual("@/lib/services/email-service-client");
  return {
    ...actual,
    buildThemedEmailBody: (...a: unknown[]) => mockBuildThemedEmailBody(...a),
  };
});

jest.mock("@/lib/channels/email-channel", () => {
  const actual = jest.requireActual("@/lib/channels/email-channel");
  return {
    ...actual,
    getEmailChannelConfig: (...a: unknown[]) => mockGetEmailChannelConfig(...a),
    isValidPort: (...a: unknown[]) => mockIsValidPort(...a),
    sendSmtpMail: (...a: unknown[]) => mockSendSmtpMail(...a),
  };
});

import type { ChannelRecord } from "@/lib/db/channel-queries";
import {
  createDefaultCommunicationChannelFactory,
  DefaultCommunicationChannelFactory,
} from "@/lib/channels/communication-channel-factory";
import type { CommunicationChannelBuilder } from "@/lib/channels/channel-builder";
import { UnsupportedChannel } from "@/lib/channels/unsupported-channel";

function makeChannel(partial: Partial<ChannelRecord>): ChannelRecord {
  return {
    id: partial.id ?? "ch-1",
    channel_type: partial.channel_type ?? "discord",
    label: partial.label ?? "Test Channel",
    enabled: partial.enabled ?? 1,
    config_json: partial.config_json ?? "{}",
    webhook_secret: partial.webhook_secret ?? null,
    user_id: partial.user_id ?? "user-1",
    created_at: partial.created_at ?? new Date().toISOString(),
  };
}

describe("createDefaultCommunicationChannelFactory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildThemedEmailBody.mockReturnValue({ text: "plain", html: "<p>html</p>" });
    mockGetEmailChannelConfig.mockReturnValue({
      smtpHost: "smtp.test.com",
      smtpPort: 587,
      smtpUser: "user",
      smtpPass: "pass",
      fromAddress: "nexus@test.com",
    });
    mockIsValidPort.mockReturnValue(true);
    mockSendSmtpMail.mockResolvedValue({ messageId: "1" });
  });

  test("builds discord channel and sends via discord dependency", async () => {
    const factory = createDefaultCommunicationChannelFactory();
    const channel = factory.create(makeChannel({ channel_type: "discord" }));

    expect(channel.capabilities.supportsDirectRecipientMapping).toBe(true);
    expect(channel.canSend({ userId: "u", subject: "s", message: "m", externalRecipientId: "discord-user" })).toBe(true);

    await channel.send({ userId: "u", subject: "s", message: "m", externalRecipientId: "discord-user" });
    expect(mockSendDiscordDm).toHaveBeenCalledWith("ch-1", "discord-user", "m");
  });

  test("builds whatsapp channel and posts via fetch dependency", async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true });
    const factory = createDefaultCommunicationChannelFactory({ fetchFn });
    const channel = factory.create(
      makeChannel({
        channel_type: "whatsapp",
        config_json: JSON.stringify({ phoneNumberId: "123", accessToken: "token", apiVersion: "v21.0" }),
      }),
    );

    expect(channel.capabilities.supportsDirectRecipientMapping).toBe(true);
    expect(channel.canSend({ userId: "u", subject: "s", message: "m", externalRecipientId: "15550001234" })).toBe(true);

    await channel.send({ userId: "u", subject: "s", message: "m", externalRecipientId: "15550001234" });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/123/messages",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("builds email channel and sends SMTP mail", async () => {
    const factory = createDefaultCommunicationChannelFactory();
    const channel = factory.create(makeChannel({ channel_type: "email" }));

    expect(channel.capabilities.supportsEmailRecipient).toBe(true);
    expect(channel.canSend({ userId: "u", subject: "Subject", message: "Message", emailRecipient: "to@test.com" })).toBe(true);

    await channel.send({ userId: "u", subject: "Subject", message: "Message", emailRecipient: "to@test.com" });

    expect(mockBuildThemedEmailBody).toHaveBeenCalledWith("Subject", "Message");
    expect(mockSendSmtpMail).toHaveBeenCalled();
  });

  test("builds teams channel and posts via webhook", async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true });
    const factory = createDefaultCommunicationChannelFactory({ fetchFn });
    const channel = factory.create(
      makeChannel({
        channel_type: "teams",
        config_json: JSON.stringify({ webhookUrl: "https://example.test/teams-webhook" }),
      }),
    );

    expect(channel.capabilities.supportsDirectRecipientMapping).toBe(true);
    expect(channel.canSend({ userId: "u", subject: "s", message: "m" })).toBe(true);

    await channel.send({ userId: "u", subject: "s", message: "m" });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://example.test/teams-webhook",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("builds slack channel and posts via webhook", async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true });
    const factory = createDefaultCommunicationChannelFactory({ fetchFn });
    const channel = factory.create(
      makeChannel({
        channel_type: "slack",
        config_json: JSON.stringify({ webhookUrl: "https://example.test/slack-webhook" }),
      }),
    );

    expect(channel.capabilities.supportsDirectRecipientMapping).toBe(true);
    expect(channel.canSend({ userId: "u", subject: "s", message: "m" })).toBe(true);

    await channel.send({ userId: "u", subject: "s", message: "m" });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://example.test/slack-webhook",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("returns unsupported channel instance for non-implemented types", async () => {
    const factory = createDefaultCommunicationChannelFactory();
    const channel = factory.create(makeChannel({ channel_type: "telegram" }));

    expect(channel.canSend({ userId: "u", subject: "s", message: "m" })).toBe(false);
    await expect(channel.send({ userId: "u", subject: "s", message: "m" })).rejects.toThrow(
      "Channel type telegram is not supported for outbound notifications.",
    );
  });

  test("default factory dispatches through injected builders", async () => {
    const mockBuilderChannel = new UnsupportedChannel(makeChannel({ channel_type: "teams" }));

    const injectedBuilder: CommunicationChannelBuilder = {
      matches: jest.fn(() => true),
      create: jest.fn(() => mockBuilderChannel),
    };

    const factory = new DefaultCommunicationChannelFactory([injectedBuilder]);
    const created = factory.create(makeChannel({ channel_type: "discord" }));

    expect(injectedBuilder.matches).toHaveBeenCalled();
    expect(injectedBuilder.create).toHaveBeenCalled();
    expect(created).toBe(mockBuilderChannel);
  });
});

