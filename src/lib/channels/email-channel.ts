import fs from "fs";
import path from "path";
import type { SendMailOptions } from "nodemailer";
import { ImapFlow } from "imapflow";
import type { ChannelRecord } from "@/lib/db/channel-queries";
import {
  BaseCommunicationChannel,
  type ChannelSendRequest,
  type CommunicationChannel,
} from "@/lib/channels/communication-channel";
import type { CommunicationChannelBuilder } from "@/lib/channels/channel-builder";
import { createLogger } from "@/lib/logging/logger";

const ATTACHMENTS_ROOT = path.join(process.cwd(), "data", "attachments");

const MIME_BY_EXT: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function guessContentType(storagePath: string): string {
  const ext = path.extname(storagePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

const log = createLogger("channels.email-channel");
import {
  EmailServiceClient,
  type EmailConnectionConfig,
  type EmailBodyContent,
  type EmailBodyOptions,
  type EmailBodyTable,
  type InboundUnknownEmailSummary,
  buildThemedEmailBody,
  summarizeInboundUnknownEmail,
} from "@/lib/services/email-service-client";

export type EmailChannelConfig = EmailConnectionConfig;

function asString(config: Record<string, unknown>, key: string, fallback = ""): string {
  const value = config[key];
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeHost(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withoutScheme = trimmed.replace(/^\w+:\/\//, "");
  const withoutPath = withoutScheme.split("/")[0];
  const withoutPort = withoutPath.includes(":") ? withoutPath.split(":")[0] : withoutPath;
  return withoutPort.trim();
}

function parsePort(config: Record<string, unknown>, key: string, fallback: number): number {
  const raw = config[key];
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0 && raw <= 65535) return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  }
  return fallback;
}

function asOptionalBoolean(config: Record<string, unknown>, key: string): boolean | null {
  const value = config[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "ssl", "tls", "secure"].includes(normalized)) return true;
    if (["false", "0", "no", "starttls", "insecure"].includes(normalized)) return false;
  }
  return null;
}

function normalizeEmail(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/<?([^<>\s]+@[^<>\s]+)>?$/);
  return (match?.[1] || trimmed).trim();
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

export function getEmailChannelConfig(config: Record<string, unknown>): EmailChannelConfig {
  const smtpUser = asString(config, "smtpUser");
  return {
    smtpHost: normalizeHost(asString(config, "smtpHost")),
    smtpPort: parsePort(config, "smtpPort", 587),
    smtpSecure: asOptionalBoolean(config, "smtpSecure"),
    smtpUser,
    smtpPass: asString(config, "smtpPass"),
    fromAddress: asString(config, "fromAddress") || smtpUser,
    imapHost: normalizeHost(asString(config, "imapHost")),
    imapPort: parsePort(config, "imapPort", 993),
    imapSecure: asOptionalBoolean(config, "imapSecure"),
    imapUser: asString(config, "imapUser"),
    imapPass: asString(config, "imapPass"),
  };
}

export { buildThemedEmailBody, summarizeInboundUnknownEmail };
export type { EmailBodyContent, EmailBodyOptions, EmailBodyTable, InboundUnknownEmailSummary };

export function getSmtpSecureCandidatesForConfig(cfg: EmailChannelConfig): boolean[] {
  return EmailServiceClient.getSmtpSecureCandidatesForConfig(cfg);
}

export function verifySmtpConfig(cfg: EmailChannelConfig): Promise<void> {
  return new EmailServiceClient(cfg).verifySmtpConfig();
}

export function sendSmtpMail(cfg: EmailChannelConfig, mail: SendMailOptions): Promise<{ messageId?: string }> {
  return new EmailServiceClient(cfg).sendSmtpMail(mail);
}

export function createImapClient(cfg: EmailChannelConfig, secure: boolean): ImapFlow {
  return new EmailServiceClient(cfg).createImapClient(secure);
}

export function getImapSecureCandidatesForConfig(cfg: EmailChannelConfig): boolean[] {
  return EmailServiceClient.getImapSecureCandidatesForConfig(cfg);
}

export function formatEmailConnectError(err: unknown): string {
  return EmailServiceClient.formatEmailConnectError(err);
}

export class EmailChannel extends BaseCommunicationChannel {
  readonly capabilities = {
    supportsDirectRecipientMapping: false,
    supportsEmailRecipient: true,
  } as const;

  constructor(
    channel: ChannelRecord,
    private readonly buildThemedEmailBodyFn: typeof buildThemedEmailBody,
    private readonly getEmailChannelConfigFn: typeof getEmailChannelConfig,
    private readonly isValidPortFn: typeof isValidPort,
    private readonly sendSmtpMailFn: (cfg: EmailChannelConfig, mail: SendMailOptions) => Promise<{ messageId?: string }>,
  ) {
    super(channel);
  }

  canSend(request: ChannelSendRequest): boolean {
    return !!request.emailRecipient;
  }

  async send(request: ChannelSendRequest): Promise<void> {
    const t0 = Date.now();
    log.enter("send", { channelId: this.id });
    const to = normalizeEmail(request.emailRecipient || "");
    if (!to) throw new Error("Email channel requires emailRecipient.");

    const emailCfg = this.getEmailChannelConfigFn(this.config);
    if (!emailCfg.smtpHost || !this.isValidPortFn(emailCfg.smtpPort) || !emailCfg.smtpUser || !emailCfg.smtpPass || !emailCfg.fromAddress) {
      throw new Error("Email channel missing SMTP config.");
    }

    const themed = this.buildThemedEmailBodyFn(request.subject, request.message);

    const fileAttachments: { filename: string; content: Buffer; contentType: string }[] = [];
    for (const att of request.attachments ?? []) {
      const fullPath = path.join(ATTACHMENTS_ROOT, att.storagePath.replace(/\.\./g, ""));
      if (fs.existsSync(fullPath)) {
        fileAttachments.push({
          filename: att.filename || path.basename(att.storagePath),
          content: fs.readFileSync(fullPath),
          contentType: guessContentType(att.storagePath),
        });
      } else {
        log.warning("send: attachment file not found, skipping", { storagePath: att.storagePath });
      }
    }

    const mailOptions: SendMailOptions = {
      from: emailCfg.fromAddress,
      to,
      subject: request.subject,
      text: themed.text,
      html: themed.html,
    };
    if (fileAttachments.length > 0) {
      mailOptions.attachments = fileAttachments;
    }

    await this.sendSmtpMailFn(emailCfg, mailOptions);
    log.exit("send", { channelId: this.id, attachments: fileAttachments.length }, Date.now() - t0);
  }
}

export class EmailChannelBuilder implements CommunicationChannelBuilder {
  constructor(
    private readonly buildThemedEmailBodyFn: typeof buildThemedEmailBody = buildThemedEmailBody,
    private readonly getEmailChannelConfigFn: typeof getEmailChannelConfig = getEmailChannelConfig,
    private readonly isValidPortFn: typeof isValidPort = isValidPort,
    private readonly sendSmtpMailFn: (cfg: EmailChannelConfig, mail: SendMailOptions) => Promise<{ messageId?: string }> = sendSmtpMail,
  ) {}

  matches(channel: ChannelRecord): boolean {
    return channel.channel_type === "email";
  }

  create(channel: ChannelRecord): CommunicationChannel {
    return new EmailChannel(
      channel,
      this.buildThemedEmailBodyFn,
      this.getEmailChannelConfigFn,
      this.isValidPortFn,
      this.sendSmtpMailFn,
    );
  }
}
