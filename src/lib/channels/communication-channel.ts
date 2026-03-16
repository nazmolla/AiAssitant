import type { ChannelRecord } from "@/lib/db/channel-queries";

export interface ChannelSendRequest {
  subject: string;
  message: string;
  userId: string;
  externalRecipientId?: string;
  emailRecipient?: string;
}

export interface ChannelCapabilities {
  supportsDirectRecipientMapping: boolean;
  supportsEmailRecipient: boolean;
}

export abstract class CommunicationChannel {
  protected readonly config: Record<string, unknown>;

  constructor(protected readonly channel: ChannelRecord) {
    this.config = this.parseConfig(channel.config_json);
  }

  get id(): string {
    return this.channel.id;
  }

  get type(): ChannelRecord["channel_type"] {
    return this.channel.channel_type;
  }

  get label(): string {
    return this.channel.label;
  }

  get enabled(): boolean {
    return this.channel.enabled === 1;
  }

  abstract readonly capabilities: ChannelCapabilities;

  abstract canSend(request: ChannelSendRequest): boolean;

  abstract send(request: ChannelSendRequest): Promise<void>;

  private parseConfig(configJson: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(configJson);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
}

export abstract class BaseCommunicationChannel extends CommunicationChannel {
  readonly capabilities: ChannelCapabilities = {
    supportsDirectRecipientMapping: false,
    supportsEmailRecipient: false,
  };
}