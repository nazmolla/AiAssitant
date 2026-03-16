import type { ChannelRecord } from "@/lib/db/channel-queries";
import {
  BaseCommunicationChannel,
  type ChannelSendRequest,
} from "@/lib/channels/communication-channel";

export class PhoneChannel extends BaseCommunicationChannel {
  readonly capabilities = {
    supportsDirectRecipientMapping: false,
    supportsEmailRecipient: false,
  } as const;

  constructor(channel: ChannelRecord) {
    super(channel);
  }

  canSend(request: ChannelSendRequest): boolean {
    // Phone channel does not support outbound sending via send() method.
    // Phone responses are returned as TwiML via the webhook handler.
    return false;
  }

  async send(request: ChannelSendRequest): Promise<void> {
    throw new Error("Phone channel does not support outbound send() calls. Use buildTwimlResponse() for webhook responses.");
  }

  /**
   * Build a TwiML (Twilio XML) response for voice messages.
   * Escapes XML special characters and constructs a Gather+Say loop.
   */
  static buildTwimlResponse(
    reply: string,
    actionUrl: string,
    voice: string = "alice"
  ): string {
    const safeReply = this.escapeXml(
      (reply || "").trim().slice(0, 2000) || "I did not catch that. Please repeat."
    );
    const safeAction = this.escapeXml(actionUrl);
    const safeVoice = this.escapeXml(voice || "alice");
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<Response>",
      `  <Say voice="${safeVoice}">${safeReply}</Say>`,
      `  <Gather input="speech" timeout="4" speechTimeout="auto" action="${safeAction}" method="POST">`,
      `    <Say voice="${safeVoice}">You can continue speaking after the tone.</Say>`,
      "  </Gather>",
      `  <Say voice="${safeVoice}">Goodbye.</Say>`,
      "</Response>",
    ].join("\n");
  }

  /**
   * Escape XML special characters to prevent injection attacks.
   */
  private static escapeXml(input: string): string {
    return input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
