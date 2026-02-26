import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import { ImapFlow } from "imapflow";

export interface EmailChannelConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPass: string;
}

function asString(config: Record<string, unknown>, key: string, fallback = ""): string {
  const value = config[key];
  return typeof value === "string" ? value.trim() : fallback;
}

export function getEmailChannelConfig(config: Record<string, unknown>): EmailChannelConfig {
  const smtpUser = asString(config, "smtpUser");
  return {
    smtpHost: asString(config, "smtpHost"),
    smtpPort: Number(asString(config, "smtpPort", "587")),
    smtpUser,
    smtpPass: asString(config, "smtpPass"),
    fromAddress: asString(config, "fromAddress") || smtpUser,
    imapHost: asString(config, "imapHost"),
    imapPort: Number(asString(config, "imapPort", "993")),
    imapUser: asString(config, "imapUser"),
    imapPass: asString(config, "imapPass"),
  };
}

function createSmtpTransport(cfg: EmailChannelConfig, secure: boolean): Transporter {
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure,
    requireTLS: !secure,
    auth: {
      user: cfg.smtpUser,
      pass: cfg.smtpPass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: {
      servername: cfg.smtpHost,
    },
  });
}

function getSmtpSecureCandidates(port: number): boolean[] {
  // Prefer expected mode by common port, but try fallback automatically.
  const preferred = port === 465;
  return preferred ? [true, false] : [false, true];
}

export async function verifySmtpConfig(cfg: EmailChannelConfig): Promise<void> {
  let lastErr: unknown = null;
  for (const secure of getSmtpSecureCandidates(cfg.smtpPort)) {
    try {
      const transporter = createSmtpTransport(cfg, secure);
      await transporter.verify();
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function sendSmtpMail(cfg: EmailChannelConfig, mail: SendMailOptions): Promise<{ messageId?: string }> {
  let lastErr: unknown = null;
  for (const secure of getSmtpSecureCandidates(cfg.smtpPort)) {
    try {
      const transporter = createSmtpTransport(cfg, secure);
      const res = await transporter.sendMail(mail);
      return { messageId: res?.messageId };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function createImapClient(cfg: EmailChannelConfig, secure: boolean): ImapFlow {
  return new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure,
    doSTARTTLS: !secure,
    auth: {
      user: cfg.imapUser,
      pass: cfg.imapPass,
    },
    logger: false,
  });
}

export function getImapSecureCandidates(port: number): boolean[] {
  const preferred = port === 993;
  return preferred ? [true, false] : [false, true];
}

export function formatEmailConnectError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("econnrefused")) {
    return `${msg} (connection refused: verify host/port and firewall)`;
  }
  if (lower.includes("etimedout") || lower.includes("timeout")) {
    return `${msg} (timeout: verify network reachability and SMTP/IMAP ports)`;
  }
  if (lower.includes("eauth") || lower.includes("auth") || lower.includes("invalid login")) {
    return `${msg} (authentication failed: verify username/password or app password)`;
  }
  if (lower.includes("ssl") || lower.includes("tls") || lower.includes("certificate")) {
    return `${msg} (TLS/certificate issue: verify correct port/security mode)`;
  }
  return msg;
}
