import type { ToolDefinition } from "@/lib/llm";
import { listChannels } from "@/lib/db/queries";
import nodemailer from "nodemailer";

export const EMAIL_TOOL_NAMES = {
  SEND: "builtin.email_send",
} as const;

export const EMAIL_TOOLS_REQUIRING_APPROVAL = [EMAIL_TOOL_NAMES.SEND];

export const BUILTIN_EMAIL_TOOLS: ToolDefinition[] = [
  {
    name: EMAIL_TOOL_NAMES.SEND,
    description:
      "Send an email using the configured Email channel SMTP settings. " +
      "Use this to notify users, send updates, or deliver requested information by email. REQUIRES APPROVAL.",
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
          description: "Plain-text email body.",
        },
        channelLabel: {
          type: "string",
          description: "Optional exact channel label to use when multiple Email channels exist.",
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

export function isEmailTool(name: string): boolean {
  return name === EMAIL_TOOL_NAMES.SEND;
}

export async function executeBuiltinEmailTool(
  name: string,
  args: Record<string, unknown>,
  userId?: string
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

  const smtpHost = getStringArg(config, "smtpHost");
  const smtpPort = Number(getStringArg(config, "smtpPort") || "587");
  const smtpUser = getStringArg(config, "smtpUser");
  const smtpPass = getStringArg(config, "smtpPass");
  const fromAddress = getStringArg(config, "fromAddress") || smtpUser;

  if (!smtpHost || !Number.isFinite(smtpPort) || !smtpUser || !smtpPass || !fromAddress) {
    throw new Error("Email channel is missing SMTP config (smtpHost/smtpPort/smtpUser/smtpPass/fromAddress).");
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const sent = await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    text: body,
  });

  return {
    status: "sent",
    channelId: channel.id,
    channelLabel: channel.label,
    to,
    subject,
    messageId: sent.messageId,
  };
}
