import type { ChannelRecord } from "@/lib/db/channel-queries";
import type { CommunicationChannel } from "@/lib/channels/communication-channel";

export interface CommunicationChannelBuilder {
  matches(channel: ChannelRecord): boolean;
  create(channel: ChannelRecord): CommunicationChannel;
}
