import {
  listUsersWithPermissions,
  listChannels,
  listChannelUserMappings,
  addLog,
  getUserProfile,
  getUserById,
} from "@/lib/db";
import { sendDiscordDirectMessage } from "@/lib/channels/discord";
import { buildThemedEmailBody, getEmailChannelConfig, sendSmtpMail } from "@/lib/channels/email-transport";

type ChannelConfig = Record<string, unknown>;
export type NotificationLevel = "low" | "medium" | "high" | "disaster";

const NOTIFICATION_LEVEL_ORDER: NotificationLevel[] = ["disaster", "high", "medium", "low"];

function normalizeNotificationLevel(value: unknown): NotificationLevel {
  if (typeof value !== "string") return "disaster";
  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "disaster") {
    return normalized;
  }
  return "disaster";
}

function shouldNotifyForLevel(userThreshold: NotificationLevel, eventLevel: NotificationLevel): boolean {
  const thresholdIndex = NOTIFICATION_LEVEL_ORDER.indexOf(userThreshold);
  const eventIndex = NOTIFICATION_LEVEL_ORDER.indexOf(eventLevel);
  if (thresholdIndex < 0 || eventIndex < 0) return eventLevel === "disaster";
  return eventIndex <= thresholdIndex;
}

export function getUserNotificationLevel(userId: string): NotificationLevel {
  const profile = getUserProfile(userId);
  return normalizeNotificationLevel(profile?.notification_level);
}

export interface NotifyOptions {
  level?: NotificationLevel;
  userId?: string;
}

function parseConfig(configJson: string): ChannelConfig {
  try {
    return JSON.parse(configJson);
  } catch {
    return {};
  }
}

function normalizeEmail(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/<?([^<>\s]+@[^<>\s]+)>?$/);
  return (match?.[1] || trimmed).trim();
}

async function sendWhatsAppText(config: ChannelConfig, to: string, text: string): Promise<void> {
  const phoneNumberId = String(config.phoneNumberId ?? config.phone_number_id ?? "").trim();
  const accessToken = String(config.accessToken ?? config.access_token ?? "").trim();
  const apiVersion = String(config.apiVersion ?? config.api_version ?? "v19.0").trim();

  if (!phoneNumberId || !accessToken) {
    throw new Error("WhatsApp channel missing phoneNumberId/accessToken.");
  }

  const baseUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;
  const res = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: text,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WhatsApp send failed: ${res.status} ${errBody}`);
  }
}

async function sendEmailText(config: ChannelConfig, to: string, subject: string, text: string): Promise<void> {
  const emailCfg = getEmailChannelConfig(config);

  if (!emailCfg.smtpHost || !Number.isFinite(emailCfg.smtpPort) || !emailCfg.smtpUser || !emailCfg.smtpPass || !emailCfg.fromAddress) {
    throw new Error("Email channel missing SMTP config.");
  }

  const themed = buildThemedEmailBody(subject, text);

  await sendSmtpMail(emailCfg, {
    from: emailCfg.fromAddress,
    to,
    subject,
    text: themed.text,
    html: themed.html,
  });
}

export async function notifyAdmin(
  message: string,
  subject = "Nexus Notification",
  options: NotifyOptions = {}
): Promise<boolean> {
  const level = options.level ?? "disaster";

  let targetUser:
    | {
        id: string;
        email: string;
      }
    | undefined;

  if (options.userId) {
    const specific = getUserById(options.userId);
    if (specific) {
      targetUser = { id: specific.id, email: specific.email };
    }
  }

  if (!targetUser) {
    const admins = listUsersWithPermissions().filter((u) => u.role === "admin" && u.enabled === 1);
    if (admins.length === 0) return false;
    const admin = admins[0];
    targetUser = { id: admin.id, email: admin.email };
  }

  const threshold = getUserNotificationLevel(targetUser.id);
  if (!shouldNotifyForLevel(threshold, level)) {
    addLog({
      level: "info",
      source: "channels",
      message: `Notification suppressed by user threshold (event=${level}, threshold=${threshold}).`,
      metadata: JSON.stringify({ userId: targetUser.id, subject }),
    });
    return false;
  }

  const channels = listChannels(targetUser.id).filter((c) => !!c.enabled);

  // Prefer IM channels first
  const imChannels = channels.filter((c) => ["whatsapp", "discord", "telegram", "slack", "teams"].includes(c.channel_type));
  for (const channel of imChannels) {
    const mappings = listChannelUserMappings(channel.id);
    const adminMapping = mappings.find((m) => m.user_id === targetUser!.id);
    if (!adminMapping) continue;

    try {
      const cfg = parseConfig(channel.config_json);
      if (channel.channel_type === "whatsapp") {
        await sendWhatsAppText(cfg, adminMapping.external_id, message);
        return true;
      }
      if (channel.channel_type === "discord") {
        await sendDiscordDirectMessage(channel.id, adminMapping.external_id, message);
        return true;
      }
    } catch (err) {
      addLog({
        level: "warn",
        source: "channels",
        message: `Failed admin IM notification via ${channel.channel_type}: ${err}`,
        metadata: JSON.stringify({ channelId: channel.id, adminId: targetUser.id }),
      });
    }
  }

  // Fallback to email
  const email = normalizeEmail(targetUser.email || "");
  if (!email) return false;

  const emailChannel = channels.find((c) => c.channel_type === "email");
  if (!emailChannel) return false;

  try {
    const cfg = parseConfig(emailChannel.config_json);
    await sendEmailText(cfg, email, subject, message);
    return true;
  } catch (err) {
    addLog({
      level: "warn",
      source: "channels",
      message: `Failed admin email notification fallback: ${err}`,
      metadata: JSON.stringify({ channelId: emailChannel.id, adminId: targetUser.id }),
    });
  }

  return false;
}
