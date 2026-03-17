import type { ChannelRecord } from "@/lib/db/channel-queries";
import { addLog } from "@/lib/db/log-queries";
import {
  BaseCommunicationChannel,
  type ChannelSendRequest,
  type CommunicationChannel,
} from "@/lib/channels/communication-channel";
import type { CommunicationChannelBuilder } from "@/lib/channels/channel-builder";
import {
  validateTwilioConfig,
  buildTwimlResponse,
  callTwilioApi,
} from "@/lib/services/phone-service";

type FetchFn = typeof fetch;

export class PhoneChannel extends BaseCommunicationChannel {
  readonly capabilities = {
    supportsDirectRecipientMapping: true,  // Phone numbers are external recipient IDs
    supportsEmailRecipient: false,
  } as const;

  constructor(
    channel: ChannelRecord,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    super(channel);
  }

  canSend(request: ChannelSendRequest): boolean {
    // Can send if we have recipient phone number and Twilio credentials
    return !!request.externalRecipientId && this.hasTwilioConfig();
  }

  async send(request: ChannelSendRequest): Promise<void> {
    if (!request.externalRecipientId) {
      throw new Error("Phone channel requires externalRecipientId (phone number to call).");
    }

    validateTwilioConfig(this.config);

    const accountSid = String(this.config.accountSid ?? "").trim();
    const authToken = String(this.config.authToken ?? "").trim();
    const fromNumber = String(this.config.phoneNumber ?? "").trim();
    const toNumber = request.externalRecipientId;
    const message = (request.message || "").trim();

    if (!message) {
      throw new Error("Phone channel requires a message to play.");
    }

    const voiceName = this.getVoiceName();

    // Build the Gather action URL so the callee can respond and the call
    // continues as a two-way conversation.  Requires NEXTAUTH_URL to be set
    // so Twilio can reach back to this server.
    const baseUrl = (process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
    const actionUrl = baseUrl
      ? `${baseUrl}/api/channels/${this.channel.id}/webhook?secret=${this.channel.webhook_secret || ""}`
      : "";

    if (!actionUrl) {
      // Fallback: announcement-only if base URL is not configured
      addLog({
        level: "warning",
        source: "channel.phone",
        message: "NEXTAUTH_URL is not set — outbound call will be announcement-only (no two-way conversation).",
        metadata: JSON.stringify({ channelId: this.channel.id }),
      });
    }

    const twiml = buildTwimlResponse(message, actionUrl, voiceName);

    await callTwilioApi(accountSid, authToken, fromNumber, toNumber, twiml, this.fetchFn);
  }

  /**
   * Build a TwiML (Twilio XML) response for voice messages.
   * Used both for inbound responses and outbound call payloads.
   */
  buildTwimlResponse(
    reply: string,
    actionUrl: string = "",
    voice: string = "alice"
  ): string {
    return buildTwimlResponse(reply, actionUrl, voice);
  }

  /**
   * Static method for building TwiML responses.
   * Used by webhook handler for inbound calls and send() for outbound calls.
   */
  static buildTwimlResponse(
    reply: string,
    actionUrl: string,
    voice: string = "alice"
  ): string {
    return buildTwimlResponse(reply, actionUrl, voice);
  }

  private hasTwilioConfig(): boolean {
    const accountSid = String(this.config.accountSid ?? "").trim();
    const authToken = String(this.config.authToken ?? "").trim();
    const phoneNumber = String(this.config.phoneNumber ?? "").trim();
    return !!(accountSid && authToken && phoneNumber);
  }

  private getVoiceName(): string {
    return String(this.config.voiceName ?? "alice").trim();
  }
}

export class PhoneChannelBuilder implements CommunicationChannelBuilder {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  matches(channel: ChannelRecord): boolean {
    return channel.channel_type === "phone";
  }

  create(channel: ChannelRecord): CommunicationChannel {
    return new PhoneChannel(channel, this.fetchFn);
  }
}
