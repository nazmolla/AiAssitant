import type { ChannelRecord } from "@/lib/db/channel-queries";
import { PhoneChannel } from "@/lib/channels/phone-channel";
import type { CommunicationChannel } from "@/lib/channels/communication-channel";
import type { CommunicationChannelBuilder } from "@/lib/channels/channel-builder";

export class PhoneChannelBuilder implements CommunicationChannelBuilder {
  matches(channel: ChannelRecord): boolean {
    return channel.channel_type === "phone";
  }

  create(channel: ChannelRecord): CommunicationChannel {
    return new PhoneChannel(channel);
  }
}
