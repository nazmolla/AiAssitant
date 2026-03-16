import type { ChannelRecord } from "@/lib/db/channel-queries";
import {
  BaseCommunicationChannel,
  type ChannelSendRequest,
  type CommunicationChannel,
} from "@/lib/channels/communication-channel";
import type { CommunicationChannelBuilder } from "@/lib/channels/channel-builder";

type FetchFn = typeof fetch;

export class WhatsAppChannel extends BaseCommunicationChannel {
  readonly capabilities = {
    supportsDirectRecipientMapping: true,
    supportsEmailRecipient: false,
  } as const;

  constructor(
    channel: ChannelRecord,
    private readonly fetchFn: FetchFn,
  ) {
    super(channel);
  }

  canSend(request: ChannelSendRequest): boolean {
    return !!request.externalRecipientId;
  }

  async send(request: ChannelSendRequest): Promise<void> {
    if (!request.externalRecipientId) {
      throw new Error("WhatsApp channel requires externalRecipientId.");
    }

    const phoneNumberId = String(this.config.phoneNumberId ?? this.config.phone_number_id ?? "").trim();
    const accessToken = String(this.config.accessToken ?? this.config.access_token ?? "").trim();
    const apiVersion = String(this.config.apiVersion ?? this.config.api_version ?? "v19.0").trim();

    if (!phoneNumberId || !accessToken) {
      throw new Error("WhatsApp channel missing phoneNumberId/accessToken.");
    }

    const baseUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;
    const response = await this.fetchFn(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: request.externalRecipientId,
        type: "text",
        text: {
          preview_url: false,
          body: request.message,
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`WhatsApp send failed: ${response.status} ${errBody}`);
    }
  }
}

export class WhatsAppChannelBuilder implements CommunicationChannelBuilder {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  matches(channel: ChannelRecord): boolean {
    return channel.channel_type === "whatsapp";
  }

  create(channel: ChannelRecord): CommunicationChannel {
    return new WhatsAppChannel(channel, this.fetchFn);
  }
}
