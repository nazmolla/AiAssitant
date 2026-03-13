import type { ToolDefinition } from "@/lib/llm";
import { getAttachment, getThread, listChannels } from "@/lib/db/queries";
import fs from "fs";
import path from "path";
import {
  buildThemedEmailBody,
  createImapClient,
  formatEmailConnectError,
  getEmailChannelConfig,
  getImapSecureCandidatesForConfig,
  isValidPort,
  sendSmtpMail,
} from "@/lib/channels/email-transport";
import { simpleParser } from "mailparser";

export const EMAIL_TOOL_NAMES = {
  SEND: "builtin.email_send",
  READ: "builtin.email_read",
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
  {
    name: EMAIL_TOOL_NAMES.READ,
    description:
      "Read emails from the configured Email channel IMAP mailbox. " +
      "Returns a list of recent messages with sender, subject, date, and a text snippet. " +
      "Use this when the user asks to check their inbox, read emails, or find specific messages.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "IMAP folder to read from (default: 'INBOX').",
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to return (1–50, default: 10).",
        },
        unreadOnly: {
          type: "boolean",
          description: "If true, only return unread/unseen messages (default: false).",
        },
        from: {
          type: "string",
          description: "Optional filter: only return messages from this sender (partial match).",
        },
        subject: {
          type: "string",
          description: "Optional filter: only return messages whose subject contains this text (case-insensitive).",
        },
        since: {
          type: "string",
          description: "Optional ISO date string: only return messages received on or after this date (e.g. '2026-03-01').",
        },
        channelLabel: {
          type: "string",
          description: "Optional exact channel label to use when multiple Email channels exist.",
        },
      },
      required: [],
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
  return name === EMAIL_TOOL_NAMES.SEND || name === EMAIL_TOOL_NAMES.READ;
}

export async function executeBuiltinEmailTool(
  name: string,
  args: Record<string, unknown>,
  userId?: string,
  threadId?: string
): Promise<unknown> {
  if (name === EMAIL_TOOL_NAMES.SEND) {
    return executeEmailSend(args, userId, threadId);
  }
  if (name === EMAIL_TOOL_NAMES.READ) {
    return executeEmailRead(args, userId);
  }
  throw new Error(`Unknown email tool: ${name}`);
}

async function executeEmailSend(
  args: Record<string, unknown>,
  userId?: string,
  threadId?: string
): Promise<unknown> {

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

  if (!emailCfg.smtpHost || !isValidPort(emailCfg.smtpPort) || !emailCfg.smtpUser || !emailCfg.smtpPass || !emailCfg.fromAddress) {
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

/* ── Email Read (IMAP) ─────────────────────────────────────────────── */

/** Max snippet chars from email body to return to the LLM (manages token budget). */
const EMAIL_BODY_SNIPPET_MAX = 500;

/** Strip HTML tags and compact whitespace for plain-text snippet. */
function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function executeEmailRead(
  args: Record<string, unknown>,
  userId?: string
): Promise<unknown> {
  const folder = getStringArg(args, "folder") || "INBOX";
  const rawLimit = typeof args.limit === "number" ? args.limit : 10;
  const limit = Math.max(1, Math.min(50, Math.round(rawLimit)));
  const unreadOnly = args.unreadOnly === true;
  const filterFrom = getStringArg(args, "from").toLowerCase();
  const filterSubject = getStringArg(args, "subject").toLowerCase();
  const sinceStr = getStringArg(args, "since");
  const channelLabel = getStringArg(args, "channelLabel");

  const channel = pickEmailChannel(userId, channelLabel || undefined);
  let rawConfig: Record<string, unknown> = {};
  try {
    rawConfig = JSON.parse(channel.config_json || "{}");
  } catch {
    rawConfig = {};
  }

  const cfg = getEmailChannelConfig(rawConfig);

  if (!cfg.imapHost || !isValidPort(cfg.imapPort) || !cfg.imapUser || !cfg.imapPass) {
    throw new Error("Email channel is missing IMAP config (imapHost/imapPort/imapUser/imapPass).");
  }

  const secureCandidates = getImapSecureCandidatesForConfig(cfg);
  let lastErr: unknown;

  for (const secure of secureCandidates) {
    const client = createImapClient(cfg, secure);
    // Swallow background socket errors — handled below
    client.on("error", () => {});

    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);

      try {
        // Build IMAP search criteria
        const searchCriteria: Record<string, unknown> = {};
        if (unreadOnly) searchCriteria.seen = false;
        if (sinceStr) {
          const since = new Date(sinceStr);
          if (!isNaN(since.getTime())) searchCriteria.since = since;
        }

        // Search for matching UIDs
        let uids: number[];
        try {
          const result = await client.search(searchCriteria, { uid: true });
          uids = result || [];
        } catch {
          uids = [];
        }

        // Take the most recent N UIDs (highest = newest)
        // We fetch more than limit to allow for post-fetch filtering
        const fetchLimit = filterFrom || filterSubject ? limit * 3 : limit;
        const targetUids = uids.slice(-fetchLimit);

        if (targetUids.length === 0) {
          return { messages: [], count: 0, folder, note: "No messages found matching criteria." };
        }

        // Fetch envelope + source for parsing
        const messages: Array<{
          uid: number;
          from: string;
          to: string;
          subject: string;
          date: string;
          snippet: string;
          seen: boolean;
        }> = [];

        for await (const msg of client.fetch(targetUids, {
          uid: true,
          envelope: true,
          source: true,
          flags: true,
        }, { uid: true })) {
          const parsed = await simpleParser(msg.source as Buffer);
          const fromAddr = parsed.from?.value?.[0]?.address || "";
          const toAddr = parsed.to
            ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
                .flatMap((t) => t.value.map((v) => v.address || ""))
                .join(", ")
            : "";
          const subjectText = (parsed.subject || "(no subject)").trim();
          const rawBody = parsed.text || (parsed.html ? stripHtml(parsed.html) : "");
          const bodySnippet = rawBody.length > EMAIL_BODY_SNIPPET_MAX
            ? rawBody.slice(0, EMAIL_BODY_SNIPPET_MAX) + "..."
            : rawBody;
          const seen = msg.flags ? new Set(msg.flags).has("\\Seen") : false;

          // Apply client-side filters
          if (filterFrom && !fromAddr.toLowerCase().includes(filterFrom)) continue;
          if (filterSubject && !subjectText.toLowerCase().includes(filterSubject)) continue;

          messages.push({
            uid: msg.uid,
            from: fromAddr,
            to: toAddr,
            subject: subjectText,
            date: parsed.date?.toISOString() || "",
            snippet: bodySnippet,
            seen,
          });

          if (messages.length >= limit) break;
        }

        // Sort newest first
        messages.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

        return {
          messages,
          count: messages.length,
          folder,
          channelLabel: channel.label,
        };
      } finally {
        lock.release();
      }
    } catch (err) {
      lastErr = err;
      try { await client.logout(); } catch { /* ignore */ }
      continue; // Try next secure candidate
    } finally {
      try { client.close(); } catch { /* ignore */ }
    }
  }

  throw new Error(formatEmailConnectError(lastErr));
}
