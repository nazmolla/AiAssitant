import type { ToolDefinition } from "@/lib/llm";
import { listChannels, listChannelUserMappings } from "@/lib/db/channel-queries";
import { getThreadMessages, type Thread } from "@/lib/db/thread-queries";
import { createNotification } from "@/lib/db/notification-queries";
import { getDb } from "@/lib/db/connection";
import {
  type CommunicationChannelFactory,
} from "@/lib/channels/communication-channel-factory";
import { BaseTool, type ToolExecutionContext, registerToolCategory } from "./base-tool";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("tools.communication-tools");

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
      "Send a message through an external communication channel (email, phone, discord, whatsapp, slack, teams). Use this when you need to deliver content externally — e.g. emailing a report, sending a file attachment, or contacting someone outside the app. For internal in-app notifications use builtin.channel_notify instead.",
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
        attachments: {
          type: "array",
          description: "Optional list of generated files to attach (email channels only). Use the storagePath and filename from a prior builtin.file_generate result.",
          items: {
            type: "object",
            properties: {
              storagePath: {
                type: "string",
                description: "Relative storage path returned by builtin.file_generate, e.g. '{threadId}/{fileId}.docx'.",
              },
              filename: {
                type: "string",
                description: "Display filename for the email attachment (e.g. 'Mohamed_Resume.docx').",
              },
            },
            required: ["storagePath"],
          },
        },
      },
      required: ["subject", "message"],
    },
  },
  {
    name: COMMUNICATION_TOOL_NAMES.NOTIFY,
    description:
      "Post an in-app notification visible in the Nexus notification bell. Use this for informational updates, findings, alerts, and status messages that don't require sending an external message. For email/discord/etc. use builtin.channel_send instead.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short notification title (shown as the heading in the notification bell).",
        },
        message: {
          type: "string",
          description: "Notification body/detail text.",
        },
        type: {
          type: "string",
          description: "Notification type: info (default) | proactive_action | tool_error | system_error | channel_error.",
        },
      },
      required: ["title", "message"],
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
      return this.executeNotify(args, context.userId);
    }
    if (toolName === COMMUNICATION_TOOL_NAMES.RECEIVE) {
      return this.executeReceive(args, context.userId);
    }
    throw new Error(`Unknown communication tool: ${toolName}`);
  }

  private executeNotify(args: Record<string, unknown>, userId?: string): unknown {
    const t0 = Date.now();
    log.enter("executeNotify", { userId });
    const title = getStringArg(args, "title");
    const message = getStringArg(args, "message");
    if (!title || !message) {
      throw new Error("Missing required args: title, message.");
    }
    const rawType = getStringArg(args, "type");
    const allowedTypes = ["info", "proactive_action", "tool_error", "system_error", "channel_error"] as const;
    type NotifType = typeof allowedTypes[number];
    const type: NotifType = (allowedTypes as readonly string[]).includes(rawType) ? rawType as NotifType : "info";

    const notification = createNotification({ userId: userId ?? "", type, title, body: message });
    const result = {
      status: "notified",
      notificationId: notification.id,
      type,
      title,
    };
    log.exit("executeNotify", { notificationId: notification.id, type }, Date.now() - t0);
    return result;
  }

  private async executeSend(args: Record<string, unknown>, userId?: string): Promise<unknown> {
    const t0 = Date.now();
    log.enter("executeSend", { userId });
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

    const rawAttachments = Array.isArray(args.attachments) ? args.attachments : [];
    const attachments = rawAttachments
      .filter((a): a is Record<string, unknown> => a !== null && typeof a === "object")
      .map((a) => ({
        storagePath: typeof a.storagePath === "string" ? a.storagePath : "",
        filename: typeof a.filename === "string" ? a.filename : undefined,
      }))
      .filter((a) => a.storagePath.length > 0);

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
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    const channelFactory = await this.getChannelFactory();
    const instance = channelFactory.create(channel);
    if (!instance.canSend(request)) {
      throw new Error(`Channel \"${channel.label}\" (${channel.channel_type}) cannot send with the provided recipient details.`);
    }

    await instance.send(request);

    const result = {
      status: "sent",
      channelId: channel.id,
      channelType: channel.channel_type,
      channelLabel: channel.label,
      recipient: emailRecipient || externalRecipientId || null,
      subject,
    };
    log.exit("executeSend", { channelId: channel.id, channelType: channel.channel_type }, Date.now() - t0);
    return result;
  }

  private async executeReceive(args: Record<string, unknown>, userId?: string): Promise<unknown> {
    const t0 = Date.now();
    log.enter("executeReceive", { userId });
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

    const result = {
      status: "ok",
      channelId: channel.id,
      channelType: channel.channel_type,
      channelLabel: channel.label,
      count: sorted.length,
      messages: sorted,
    };
    log.exit("executeReceive", { channelId: channel.id, count: sorted.length }, Date.now() - t0);
    return result;
  }
}

export const communicationTools = new CommunicationTools();
export const isCommunicationTool = CommunicationTools.isCommunicationTool.bind(CommunicationTools);
export const executeBuiltinCommunicationTool = communicationTools.execute.bind(communicationTools);

registerToolCategory(communicationTools);