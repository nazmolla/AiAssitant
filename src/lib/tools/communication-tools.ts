import type { ToolDefinition } from "@/lib/llm";
import {
  listChannels,
  listChannelUserMappings,
  getDb,
  getThreadMessages,
  type Thread,
} from "@/lib/db";
import {
  type CommunicationChannelFactory,
} from "@/lib/channels/communication-channel-factory";
import { BaseTool, type ToolExecutionContext, registerToolCategory } from "./base-tool";

export const COMMUNICATION_TOOL_NAMES = {
  SEND: "builtin.channel_send",
  NOTIFY: "builtin.channel_notify",
  RECEIVE: "builtin.channel_receive",
} as const;

export const COMMUNICATION_TOOLS_REQUIRING_APPROVAL: string[] = [];

export const BUILTIN_COMMUNICATION_TOOLS: ToolDefinition[] = [
  {
    name: COMMUNICATION_TOOL_NAMES.SEND,
    description:
      "Send a message through an enabled communication channel (email, phone, discord, whatsapp, slack, teams).",
    inputSchema: {
      type: "object",
      properties: {
        channelType: {
          type: "string",
          description: "Optional channel type: email | phone | discord | whatsapp | slack | teams | telegram.",
        },
        channelLabel: {
          type: "string",
          description: "Optional exact channel label when multiple channels of the same type exist.",
        },
        externalRecipientId: {
          type: "string",
          description: "External recipient identifier for non-email channels (e.g., phone number or platform user id).",
        },
        emailRecipient: {
          type: "string",
          description: "Email recipient address when sending through an email channel.",
        },
        to: {
          type: "string",
          description: "Compatibility alias for recipient (email address or external recipient id).",
        },
        subject: {
          type: "string",
          description: "Message subject.",
        },
        message: {
          type: "string",
          description: "Message body/content.",
        },
      },
      required: ["subject", "message"],
    },
  },
  {
    name: COMMUNICATION_TOOL_NAMES.NOTIFY,
    description:
      "Send a notification through an enabled communication channel (email, phone, discord, whatsapp, slack, teams). Alias of channel_send with optional subject.",
    inputSchema: {
      type: "object",
      properties: {
        channelType: {
          type: "string",
          description: "Optional channel type: email | phone | discord | whatsapp | slack | teams | telegram.",
        },
        channelLabel: {
          type: "string",
          description: "Optional exact channel label when multiple channels of the same type exist.",
        },
        externalRecipientId: {
          type: "string",
          description: "External recipient identifier for non-email channels (e.g., phone number or platform user id).",
        },
        emailRecipient: {
          type: "string",
          description: "Email recipient address when sending through an email channel.",
        },
        to: {
          type: "string",
          description: "Compatibility alias for recipient (email address or external recipient id).",
        },
        subject: {
          type: "string",
          description: "Optional notification subject. Defaults to 'Nexus Notification'.",
        },
        message: {
          type: "string",
          description: "Notification body/content.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: COMMUNICATION_TOOL_NAMES.RECEIVE,
    description:
      "Receive recent channel messages from persisted channel threads for the selected channel.",
    inputSchema: {
      type: "object",
      properties: {
        channelType: {
          type: "string",
          description: "Optional channel type filter: email | phone | discord | whatsapp | slack | teams | telegram.",
        },
        channelLabel: {
          type: "string",
          description: "Optional exact channel label.",
        },
        externalSenderId: {
          type: "string",
          description: "Optional external sender id filter.",
        },
        limit: {
          type: "number",
          description: "Max number of messages to return (1-50, default 10).",
        },
      },
      required: [],
    },
  },
];

type ChannelType = "whatsapp" | "slack" | "email" | "telegram" | "discord" | "teams" | "phone";

function getStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function pickChannel(
  userId: string | undefined,
  channelType?: string,
  channelLabel?: string,
) {
  const channels = listChannels(userId).filter((channel) => channel.enabled === 1);
  let filtered = channels;

  if (channelType) {
    filtered = filtered.filter((channel) => channel.channel_type === channelType as ChannelType);
  }

  if (channelLabel) {
    filtered = filtered.filter(
      (channel) => channel.label.trim().toLowerCase() === channelLabel.trim().toLowerCase(),
    );
  }

  if (filtered.length === 0) {
    throw new Error("No enabled communication channel matches the selection.");
  }

  return filtered[0];
}

function normalizeLimit(value: unknown, fallback = 10): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(50, Math.max(1, Math.trunc(raw)));
}

function findMappedExternalRecipient(channelId: string, userId?: string): string | undefined {
  if (!userId) return undefined;
  const mappings = listChannelUserMappings(channelId);
  return mappings.find((mapping) => mapping.user_id === userId)?.external_id;
}

export class CommunicationTools extends BaseTool {
  readonly name = "communication";
  readonly toolNamePrefix = "builtin.channel_";
  readonly registrationOrder = 40;
  readonly tools = BUILTIN_COMMUNICATION_TOOLS;
  readonly toolsRequiringApproval = [...COMMUNICATION_TOOLS_REQUIRING_APPROVAL];

  constructor(
    private channelFactory?: CommunicationChannelFactory,
  ) {
    super();
  }

  private async getChannelFactory(): Promise<CommunicationChannelFactory> {
    if (!this.channelFactory) {
      const { createDefaultCommunicationChannelFactory } = await import("@/lib/channels/communication-channel-factory");
      this.channelFactory = createDefaultCommunicationChannelFactory();
    }
    return this.channelFactory;
  }

  static isCommunicationTool(name: string): boolean {
    return (
      name === COMMUNICATION_TOOL_NAMES.SEND ||
      name === COMMUNICATION_TOOL_NAMES.NOTIFY ||
      name === COMMUNICATION_TOOL_NAMES.RECEIVE
    );
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    if (toolName === COMMUNICATION_TOOL_NAMES.SEND) {
      return this.executeSend(args, context.userId);
    }
    if (toolName === COMMUNICATION_TOOL_NAMES.NOTIFY) {
      const subject = getStringArg(args, "subject") || "Nexus Notification";
      const message = getStringArg(args, "message");
      if (!message) {
        throw new Error("Missing required args: message.");
      }
      return this.executeSend({ ...args, subject, message }, context.userId);
    }
    if (toolName === COMMUNICATION_TOOL_NAMES.RECEIVE) {
      return this.executeReceive(args, context.userId);
    }
    throw new Error(`Unknown communication tool: ${toolName}`);
  }

  private async executeSend(args: Record<string, unknown>, userId?: string): Promise<unknown> {
    const channelType = getStringArg(args, "channelType");
    const channelLabel = getStringArg(args, "channelLabel");
    const subject = getStringArg(args, "subject");
    const message = getStringArg(args, "message");
    const aliasTo = getStringArg(args, "to");
    const explicitEmail = getStringArg(args, "emailRecipient");
    const explicitExternal = getStringArg(args, "externalRecipientId");

    if (!subject || !message) {
      throw new Error("Missing required args: subject, message.");
    }

    const channel = pickChannel(userId, channelType || undefined, channelLabel || undefined);
    const isEmailChannel = channel.channel_type === "email";
    const emailRecipient = explicitEmail || (isEmailChannel ? aliasTo : "");
    const externalRecipientId = explicitExternal || (!isEmailChannel ? aliasTo : "") || findMappedExternalRecipient(channel.id, userId);

    const request = {
      userId: userId ?? channel.user_id ?? "",
      subject,
      message,
      emailRecipient: emailRecipient || undefined,
      externalRecipientId: externalRecipientId || undefined,
    };

    const channelFactory = await this.getChannelFactory();
    const instance = channelFactory.create(channel);
    if (!instance.canSend(request)) {
      throw new Error(`Channel \"${channel.label}\" (${channel.channel_type}) cannot send with the provided recipient details.`);
    }

    await instance.send(request);

    return {
      status: "sent",
      channelId: channel.id,
      channelType: channel.channel_type,
      channelLabel: channel.label,
      recipient: emailRecipient || externalRecipientId || null,
      subject,
    };
  }

  private async executeReceive(args: Record<string, unknown>, userId?: string): Promise<unknown> {
    const channelType = getStringArg(args, "channelType");
    const channelLabel = getStringArg(args, "channelLabel");
    const externalSenderId = getStringArg(args, "externalSenderId");
    const limit = normalizeLimit(args.limit, 10);

    const channel = pickChannel(userId, channelType || undefined, channelLabel || undefined);

    const db = getDb();
    const params: unknown[] = [channel.id];
    let query = `
      SELECT id, external_sender_id, last_message_at
      FROM threads
      WHERE thread_type = 'channel'
        AND channel_id = ?
    `;

    if (userId) {
      query += " AND user_id = ?";
      params.push(userId);
    }
    if (externalSenderId) {
      query += " AND external_sender_id = ?";
      params.push(externalSenderId);
    }

    query += " ORDER BY last_message_at DESC LIMIT 20";

    const threads = db.prepare(query).all(...params) as Array<Pick<Thread, "id" | "external_sender_id" | "last_message_at">>;

    const messages: Array<{
      threadId: string;
      externalSenderId: string | null;
      role: string;
      content: string;
      createdAt: string | null;
    }> = [];

    for (const thread of threads) {
      const threadMessages = getThreadMessages(thread.id)
        .filter((message) => message.role === "user" && typeof message.content === "string" && message.content.trim().length > 0)
        .slice(-limit);

      for (const message of threadMessages) {
        messages.push({
          threadId: thread.id,
          externalSenderId: thread.external_sender_id,
          role: message.role,
          content: message.content || "",
          createdAt: message.created_at,
        });
      }
    }

    const sorted = messages
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
      .slice(-limit);

    return {
      status: "ok",
      channelId: channel.id,
      channelType: channel.channel_type,
      channelLabel: channel.label,
      count: sorted.length,
      messages: sorted,
    };
  }
}

export const communicationTools = new CommunicationTools();
export const isCommunicationTool = CommunicationTools.isCommunicationTool.bind(CommunicationTools);
export const executeBuiltinCommunicationTool = communicationTools.execute.bind(communicationTools);

registerToolCategory(communicationTools);