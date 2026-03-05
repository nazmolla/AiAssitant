import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import { ImapFlow } from "imapflow";

export interface EmailChannelConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean | null;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean | null;
  imapUser: string;
  imapPass: string;
}

export interface EmailBodyContent {
  text: string;
  html: string;
}

export interface EmailBodyTable {
  headers: string[];
  rows: Array<Array<string | number>>;
}

export interface EmailBodyOptions {
  table?: EmailBodyTable;
}

function asString(config: Record<string, unknown>, key: string, fallback = ""): string {
  const value = config[key];
  return typeof value === "string" ? value.trim() : fallback;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTableHtml(table: EmailBodyTable): string {
  if (!Array.isArray(table.headers) || table.headers.length === 0 || !Array.isArray(table.rows) || table.rows.length === 0) {
    return "";
  }

  const headerCells = table.headers
    .map((header) => `<th style="padding:10px 12px;text-align:left;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#8fb7dd;border-bottom:1px solid #2a4464;">${escapeHtml(String(header))}</th>`)
    .join("");

  const rowHtml = table.rows
    .map((row) => {
      const cells = row
        .map((cell) => `<td style="padding:10px 12px;font-size:14px;line-height:1.5;color:#d9e8ff;border-bottom:1px solid #1b2f49;vertical-align:top;">${escapeHtml(String(cell ?? ""))}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:14px 0 8px 0;border:1px solid #2a4464;border-radius:10px;overflow:hidden;background:#0a1728;">
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${rowHtml}</tbody>
  </table>`;
}

function parseKeyValueLines(lines: string[]): { pairs: Array<[string, string]>; rest: string[] } {
  const pairs: Array<[string, string]> = [];
  const rest: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_\-\s/]{1,48}):\s*(.+)$/);
    if (match) {
      pairs.push([match[1].trim(), match[2].trim()]);
    } else {
      rest.push(line);
    }
  }

  if (pairs.length < 2) {
    return { pairs: [], rest: lines };
  }

  return { pairs, rest };
}

export function buildThemedEmailBody(subject: string, body: string, options: EmailBodyOptions = {}): EmailBodyContent {
  const trimmedSubject = subject.trim() || "Nexus Update";
  const trimmedBody = body.trim() || "No additional details provided.";
  const escapedSubject = escapeHtml(trimmedSubject);
  const lines = trimmedBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = parseKeyValueLines(lines.length > 0 ? lines : [trimmedBody]);
  const paragraphs = (parsed.rest.length > 0 ? parsed.rest : [trimmedBody])
    .map((line) => `<p style="margin:0 0 10px 0;">${escapeHtml(line)}</p>`)
    .join("");

  const keyValueTableHtml = parsed.pairs.length > 0
    ? renderTableHtml({ headers: ["Field", "Value"], rows: parsed.pairs })
    : "";

  const customTableHtml = options.table ? renderTableHtml(options.table) : "";

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedSubject}</title>
  </head>
  <body style="margin:0;padding:0;background:#060b14;color:#eaf2ff;font-family:Inter,Segoe UI,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#060b14;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;width:100%;border-radius:14px;overflow:hidden;border:1px solid #17304d;background:linear-gradient(180deg,#0b1a2d 0%,#0b1220 100%);">
            <tr>
              <td style="padding:18px 22px;border-bottom:1px solid #17304d;background:linear-gradient(90deg,#0f2945 0%,#102137 100%);">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8ac7ff;">Nexus</div>
                <h1 style="margin:8px 0 0 0;font-size:20px;line-height:1.35;color:#f1f7ff;">${escapedSubject}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:22px;font-size:15px;line-height:1.7;color:#d9e8ff;">
                <p style="margin:0 0 12px 0;">Hello,</p>
                ${paragraphs}
                ${keyValueTableHtml}
                ${customTableHtml}
                <p style="margin:18px 0 0 0;color:#a9c7e8;">Nexus Assistant</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const kvText = parsed.pairs.length > 0
    ? `\n\nDetails:\n${parsed.pairs.map(([k, v]) => `- ${k}: ${v}`).join("\n")}`
    : "";
  const tableText = options.table && options.table.rows.length > 0
    ? `\n\n${options.table.headers.join(" | ")}\n${options.table.rows.map((row) => row.map((cell) => String(cell ?? "")).join(" | ")).join("\n")}`
    : "";
  const text = `Hello,\n\n${trimmedBody}${kvText}${tableText}\n\nNexus Assistant`;
  return { text, html };
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

export function getEmailChannelConfig(config: Record<string, unknown>): EmailChannelConfig {
  const smtpUser = asString(config, "smtpUser");
  return {
    smtpHost: asString(config, "smtpHost"),
    smtpPort: Number(asString(config, "smtpPort", "587")),
    smtpSecure: asOptionalBoolean(config, "smtpSecure"),
    smtpUser,
    smtpPass: asString(config, "smtpPass"),
    fromAddress: asString(config, "fromAddress") || smtpUser,
    imapHost: asString(config, "imapHost"),
    imapPort: Number(asString(config, "imapPort", "993")),
    imapSecure: asOptionalBoolean(config, "imapSecure"),
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

function getSmtpSecureCandidatesForConfig(cfg: EmailChannelConfig): boolean[] {
  if (cfg.smtpSecure !== null) {
    return [cfg.smtpSecure];
  }
  return getSmtpSecureCandidates(cfg.smtpPort);
}

export async function verifySmtpConfig(cfg: EmailChannelConfig): Promise<void> {
  let lastErr: unknown = null;
  for (const secure of getSmtpSecureCandidatesForConfig(cfg)) {
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
  for (const secure of getSmtpSecureCandidatesForConfig(cfg)) {
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
    socketTimeout: 30_000,
    emitLogs: false,
  });
}

export function getImapSecureCandidates(port: number): boolean[] {
  const preferred = port === 993;
  return preferred ? [true, false] : [false, true];
}

export function getImapSecureCandidatesForConfig(cfg: EmailChannelConfig): boolean[] {
  if (cfg.imapSecure !== null) {
    return [cfg.imapSecure];
  }
  return getImapSecureCandidates(cfg.imapPort);
}

export function formatEmailConnectError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  const host = err && typeof err === "object" && "host" in err ? String((err as { host?: unknown }).host || "") : "";
  const port = err && typeof err === "object" && "port" in err ? String((err as { port?: unknown }).port || "") : "";
  const endpoint = host && port ? ` ${host}:${port}` : "";

  if (lower.includes("econnrefused")) {
    return `${msg}${endpoint ? ` [${endpoint.trim()}]` : ""} (connection refused: verify host/port and firewall)`;
  }
  if (lower.includes("etimedout") || lower.includes("timeout")) {
    return `${msg}${endpoint ? ` [${endpoint.trim()}]` : ""} (timeout: verify network reachability and SMTP/IMAP ports)`;
  }
  if (lower.includes("eauth") || lower.includes("auth") || lower.includes("invalid login")) {
    return `${msg} (authentication failed: verify username/password or app password)`;
  }
  if (lower.includes("ssl") || lower.includes("tls") || lower.includes("certificate")) {
    return `${msg} (TLS/certificate issue: verify correct port/security mode)`;
  }
  return msg;
}
