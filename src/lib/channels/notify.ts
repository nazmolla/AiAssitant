/**
 * channels/notify.ts — External channel delivery (Discord, WhatsApp, email).
 *
 * This module handles ONLY the transport layer for sending notifications via
 * external communication channels. Notification lifecycle (in-app persistence,
 * threshold filtering, user resolution) lives in @/lib/notifications.
 *
 * Re-exports from @/lib/notifications for backward compatibility.
 */

import {
  listChannels,
  listChannelUserMappings,
  addLog,
} from "@/lib/db";
import { sendDiscordDirectMessage } from "@/lib/channels/discord";
import { buildThemedEmailBody, getEmailChannelConfig, isValidPort, sendSmtpMail } from "@/lib/channels/email-transport";

// Re-export from canonical location for backward compatibility
export { notify, notifyAdmin, getUserNotificationLevel, shouldNotifyForLevel, normalizeNotificationLevel } from "@/lib/notifications";
export type { NotificationLevel, NotifyOptions } from "@/lib/notifications";

type ChannelConfig = Record<string, unknown>;

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

  if (!emailCfg.smtpHost || !isValidPort(emailCfg.smtpPort) || !emailCfg.smtpUser || !emailCfg.smtpPass || !emailCfg.fromAddress) {
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

/**
 * Send a notification via external channels (Discord, WhatsApp, email).
 *
 * Called by the app-level notify() after the event passes the user's
 * notification_level threshold. This function does NOT check thresholds.
 */
export async function sendChannelNotification(
  userId: string,
  email: string,
  message: string,
  subject: string,
): Promise<boolean> {
  const channels = listChannels(userId).filter((c) => !!c.enabled);

  // Prefer IM channels first
  const imChannels = channels.filter((c) => ["whatsapp", "discord", "telegram", "slack", "teams"].includes(c.channel_type));
  for (const channel of imChannels) {
    const mappings = listChannelUserMappings(channel.id);
    const userMapping = mappings.find((m) => m.user_id === userId);
    if (!userMapping) continue;

    try {
      const cfg = parseConfig(channel.config_json);
      if (channel.channel_type === "whatsapp") {
        await sendWhatsAppText(cfg, userMapping.external_id, message);
        return true;
      }
      if (channel.channel_type === "discord") {
        await sendDiscordDirectMessage(channel.id, userMapping.external_id, message);
        return true;
      }
    } catch (err) {
      addLog({
        level: "warn",
        source: "channels",
        message: `Failed channel notification via ${channel.channel_type}: ${err}`,
        metadata: JSON.stringify({ channelId: channel.id, userId }),
      });
    }
  }

  // Fallback to email
  const normalizedEmail = normalizeEmail(email || "");
  if (!normalizedEmail) return false;

  const emailChannel = channels.find((c) => c.channel_type === "email");
  if (!emailChannel) return false;

  try {
    const cfg = parseConfig(emailChannel.config_json);
    await sendEmailText(cfg, normalizedEmail, subject, message);
    return true;
  } catch (err) {
    addLog({
      level: "warn",
      source: "channels",
      message: `Failed channel email notification fallback: ${err}`,
      metadata: JSON.stringify({ channelId: emailChannel.id, userId }),
    });
  }

  return false;
}
