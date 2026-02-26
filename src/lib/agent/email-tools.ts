import type { ToolDefinition } from "@/lib/llm";
import { getAttachment, getThread, listChannels } from "@/lib/db/queries";
import fs from "fs";
import path from "path";
import {
  buildThemedEmailBody,
  formatEmailConnectError,
  getEmailChannelConfig,
  sendSmtpMail,
} from "@/lib/channels/email-transport";

export const EMAIL_TOOL_NAMES = {
  SEND: "builtin.email_send",
} as const;

export const EMAIL_TOOLS_REQUIRING_APPROVAL: string[] = [];

export const BUILTIN_EMAIL_TOOLS: ToolDefinition[] = [
  {
    name: EMAIL_TOOL_NAMES.SEND,
    description:
      "Send an email using the configured Email channel SMTP settings. " +
      "Use this to notify users, send updates, or deliver requested information by email.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address.",
        },
        subject: {
          type: "string",
          description: "Email subject line.",
        },
        body: {
          type: "string",
          description: "Email body content. It will be formatted into a themed informal HTML email.",
        },
        channelLabel: {
          type: "string",
          description: "Optional exact channel label to use when multiple Email channels exist.",
        },
        attachmentIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional attachment IDs from the current thread to include in the email.",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
];

function normalizeEmail(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/<?([^<>\s]+@[^<>\s]+)>?$/);
  return (match?.[1] || trimmed).trim();
}

function getStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function pickEmailChannel(configUserId?: string, channelLabel?: string) {
  const channels = listChannels(configUserId).filter(
    (c) => c.channel_type === "email" && !!c.enabled
  );

  if (channels.length === 0) {
    throw new Error("No enabled Email channel found for this user.");
  }

  if (channelLabel) {
    const match = channels.find(
      (c) => c.label.trim().toLowerCase() === channelLabel.trim().toLowerCase()
    );
    if (!match) {
      throw new Error(`Email channel \"${channelLabel}\" was not found or is disabled.`);
    }
    return match;
  }

  return channels[0];
}

function resolveAttachments(
  args: Record<string, unknown>,
  userId?: string,
  threadId?: string
): Array<{ filename: string; path: string; contentType?: string }> {
  const raw = args.attachmentIds;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const thread = threadId ? getThread(threadId) : undefined;
  if (thread && userId && thread.user_id !== userId) {
    throw new Error("Cannot attach files from a thread owned by another user.");
  }

  const root = path.join(process.cwd(), "data", "attachments");
  const attachments: Array<{ filename: string; path: string; contentType?: string }> = [];

  for (const id of raw) {
    if (typeof id !== "string" || !id.trim()) continue;
    const rec = getAttachment(id.trim());
    if (!rec) continue;
    if (threadId && rec.thread_id !== threadId) continue;
    if (thread?.user_id && userId && thread.user_id !== userId) continue;

    const fullPath = path.join(root, rec.storage_path);
    if (!fs.existsSync(fullPath)) continue;
    attachments.push({
      filename: rec.filename,
      path: fullPath,
      contentType: rec.mime_type,
    });
  }
  return attachments;
}

export function isEmailTool(name: string): boolean {
  return name === EMAIL_TOOL_NAMES.SEND;
}

export async function executeBuiltinEmailTool(
  name: string,
  args: Record<string, unknown>,
  userId?: string,
  threadId?: string
): Promise<unknown> {
  if (name !== EMAIL_TOOL_NAMES.SEND) {
    throw new Error(`Unknown email tool: ${name}`);
  }

  const to = normalizeEmail(getStringArg(args, "to"));
  const subject = getStringArg(args, "subject");
  const body = getStringArg(args, "body");
  const channelLabel = getStringArg(args, "channelLabel");

  if (!to || !subject || !body) {
    throw new Error("Missing required args: to, subject, body.");
  }

  const channel = pickEmailChannel(userId, channelLabel || undefined);
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(channel.config_json || "{}");
  } catch {
    config = {};
  }

  const emailCfg = getEmailChannelConfig(config);

  if (!emailCfg.smtpHost || !Number.isFinite(emailCfg.smtpPort) || !emailCfg.smtpUser || !emailCfg.smtpPass || !emailCfg.fromAddress) {
    throw new Error("Email channel is missing SMTP config (smtpHost/smtpPort/smtpUser/smtpPass/fromAddress).");
  }

  let messageId: string | undefined;
  try {
    const themed = buildThemedEmailBody(subject, body);
    const attachments = resolveAttachments(args, userId, threadId);
    const sent = await sendSmtpMail(emailCfg, {
      from: emailCfg.fromAddress,
      to,
      subject,
      text: themed.text,
      html: themed.html,
      attachments,
    });
    messageId = sent.messageId;
  } catch (err) {
    throw new Error(formatEmailConnectError(err));
  }

  return {
    status: "sent",
    channelId: channel.id,
    channelLabel: channel.label,
    to,
    subject,
    messageId,
  };
}
