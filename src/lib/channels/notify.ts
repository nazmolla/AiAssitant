import { listUsersWithPermissions, listChannels, listChannelUserMappings, addLog } from "@/lib/db";
import nodemailer from "nodemailer";
import { sendDiscordDirectMessage } from "@/lib/channels/discord";

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
  const smtpHost = String(config.smtpHost ?? "").trim();
  const smtpPort = Number(config.smtpPort ?? 587);
  const smtpUser = String(config.smtpUser ?? "").trim();
  const smtpPass = String(config.smtpPass ?? "").trim();
  const fromAddress = String(config.fromAddress ?? smtpUser).trim();
  const secure = smtpPort === 465;

  if (!smtpHost || !Number.isFinite(smtpPort) || !smtpUser || !smtpPass || !fromAddress) {
    throw new Error("Email channel missing SMTP config.");
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    text,
  });
}

export async function notifyAdmin(message: string, subject = "Nexus Notification"): Promise<void> {
  const admins = listUsersWithPermissions().filter((u) => u.role === "admin" && u.enabled === 1);
  if (admins.length === 0) return;
  const admin = admins[0];

  const channels = listChannels(admin.id).filter((c) => !!c.enabled);

  // Prefer IM channels first
  const imChannels = channels.filter((c) => ["whatsapp", "discord", "telegram", "slack", "teams"].includes(c.channel_type));
  for (const channel of imChannels) {
    const mappings = listChannelUserMappings(channel.id);
    const adminMapping = mappings.find((m) => m.user_id === admin.id);
    if (!adminMapping) continue;

    try {
      const cfg = parseConfig(channel.config_json);
      if (channel.channel_type === "whatsapp") {
        await sendWhatsAppText(cfg, adminMapping.external_id, message);
        return;
      }
      if (channel.channel_type === "discord") {
        await sendDiscordDirectMessage(channel.id, adminMapping.external_id, message);
        return;
      }
    } catch (err) {
      addLog({
        level: "warn",
        source: "channels",
        message: `Failed admin IM notification via ${channel.channel_type}: ${err}`,
        metadata: JSON.stringify({ channelId: channel.id, adminId: admin.id }),
      });
    }
  }

  // Fallback to email
  const email = normalizeEmail(admin.email || "");
  if (!email) return;

  const emailChannel = channels.find((c) => c.channel_type === "email");
  if (!emailChannel) return;

  try {
    const cfg = parseConfig(emailChannel.config_json);
    await sendEmailText(cfg, email, subject, message);
  } catch (err) {
    addLog({
      level: "warn",
      source: "channels",
      message: `Failed admin email notification fallback: ${err}`,
      metadata: JSON.stringify({ channelId: emailChannel.id, adminId: admin.id }),
    });
  }
}
