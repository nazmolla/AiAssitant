import type { ChannelRecord } from "@/lib/db/channel-queries";
import {
  BaseCommunicationChannel,
  type ChannelSendRequest,
  type CommunicationChannel,
} from "@/lib/channels/communication-channel";
import type { CommunicationChannelBuilder } from "@/lib/channels/channel-builder";

export class UnsupportedChannel extends BaseCommunicationChannel {
  canSend(_request: ChannelSendRequest): boolean {
    return false;
  }

  async send(_request: ChannelSendRequest): Promise<void> {
    throw new Error(`Channel type ${this.type} is not supported for outbound notifications.`);
  }
}

export class UnsupportedChannelBuilder implements CommunicationChannelBuilder {
  matches(_channel: ChannelRecord): boolean {
    return true;
  }

  create(channel: ChannelRecord): CommunicationChannel {
    return new UnsupportedChannel(channel);
  }
}
