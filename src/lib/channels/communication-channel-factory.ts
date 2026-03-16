import type { SendMailOptions } from "nodemailer";
import type { ChannelRecord } from "@/lib/db/channel-queries";
import { sendDiscordChannelDirectMessage } from "@/lib/channels/discord-channel";
import {
  getEmailChannelConfig,
  isValidPort,
  sendSmtpMail,
} from "@/lib/channels/email-channel";
import { buildThemedEmailBody } from "@/lib/services/email-service-client";
import { DiscordChannelBuilder } from "@/lib/channels/discord-channel";
import { WhatsAppChannelBuilder } from "@/lib/channels/whatsapp-channel";
import { SlackChannelBuilder } from "@/lib/channels/slack-channel";
import { TeamsChannelBuilder } from "@/lib/channels/teams-channel";
import { EmailChannelBuilder } from "@/lib/channels/email-channel";
import { PhoneChannelBuilder } from "@/lib/channels/phone-channel-builder";
import { UnsupportedChannelBuilder } from "@/lib/channels/unsupported-channel";
import type { CommunicationChannel } from "@/lib/channels/communication-channel";
import type { CommunicationChannelBuilder } from "@/lib/channels/channel-builder";

type FetchFn = typeof fetch;

export interface ChannelFactoryDependencies {
  fetchFn?: FetchFn;
  sendDiscordDirectMessageFn?: typeof sendDiscordChannelDirectMessage;
  buildThemedEmailBodyFn?: typeof buildThemedEmailBody;
  getEmailChannelConfigFn?: typeof getEmailChannelConfig;
  isValidPortFn?: typeof isValidPort;
  sendSmtpMailFn?: (cfg: ReturnType<typeof getEmailChannelConfig>, mail: SendMailOptions) => Promise<{ messageId?: string }>;
}

export abstract class CommunicationChannelFactory {
  abstract create(channel: ChannelRecord): CommunicationChannel;
}

export class DefaultCommunicationChannelFactory extends CommunicationChannelFactory {
  constructor(private readonly builders: CommunicationChannelBuilder[]) {
    super();
  }

  create(channel: ChannelRecord): CommunicationChannel {
    const builder = this.builders.find((b) => b.matches(channel));
    if (!builder) {
      throw new Error(`No channel builder registered for channel type ${channel.channel_type}`);
    }
    return builder.create(channel);
  }
}

export function buildDefaultChannelBuilders(
  deps: ChannelFactoryDependencies = {},
): CommunicationChannelBuilder[] {
  const fetchFn = deps.fetchFn ?? fetch;
  const sendDiscordDirectMessageFn = deps.sendDiscordDirectMessageFn ?? sendDiscordChannelDirectMessage;
  const buildThemedEmailBodyFn = deps.buildThemedEmailBodyFn ?? buildThemedEmailBody;
  const getEmailChannelConfigFn = deps.getEmailChannelConfigFn ?? getEmailChannelConfig;
  const isValidPortFn = deps.isValidPortFn ?? isValidPort;
  const sendSmtpMailFn = deps.sendSmtpMailFn ?? sendSmtpMail;

  return [
    new DiscordChannelBuilder(sendDiscordDirectMessageFn),
    new WhatsAppChannelBuilder(fetchFn),
    new SlackChannelBuilder(fetchFn),
    new TeamsChannelBuilder(fetchFn),
    new EmailChannelBuilder(
      buildThemedEmailBodyFn,
      getEmailChannelConfigFn,
      isValidPortFn,
      sendSmtpMailFn,
    ),
    new PhoneChannelBuilder(),
    new UnsupportedChannelBuilder(),
  ];
}

export function createDefaultCommunicationChannelFactory(
  deps: ChannelFactoryDependencies = {},
): CommunicationChannelFactory {
  return new DefaultCommunicationChannelFactory(buildDefaultChannelBuilders(deps));
}

