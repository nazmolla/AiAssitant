import type { ChannelRecord } from "@/lib/db/channel-queries";
import {
  BaseCommunicationChannel,
  type ChannelSendRequest,
  type CommunicationChannel,
} from "@/lib/channels/communication-channel";
import type { CommunicationChannelBuilder } from "@/lib/channels/channel-builder";

type FetchFn = typeof fetch;

export class SlackChannel extends BaseCommunicationChannel {
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
    return !!request.externalRecipientId || !!String(this.config.webhookUrl ?? this.config.webhook_url ?? "").trim();
  }

  async send(request: ChannelSendRequest): Promise<void> {
    const webhookUrl = String(this.config.webhookUrl ?? this.config.webhook_url ?? "").trim();
    if (!webhookUrl) {
      throw new Error("Slack channel missing webhookUrl.");
    }

    const response = await this.fetchFn(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: request.message,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Slack send failed: ${response.status} ${errBody}`);
    }
  }
}

export class SlackChannelBuilder implements CommunicationChannelBuilder {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  matches(channel: ChannelRecord): boolean {
    return channel.channel_type === "slack";
  }

  create(channel: ChannelRecord): CommunicationChannel {
    return new SlackChannel(channel, this.fetchFn);
  }
}
