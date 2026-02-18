import { NextRequest, NextResponse } from "next/server";
import { runAgentLoop, type AgentResponse } from "@/lib/agent";
import { getChannel, getDb, type AttachmentMeta } from "@/lib/db";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";

/**
 * Inbound webhook handler for channel messages.
 * External platforms (Slack, WhatsApp, etc.) POST here.
 * The agent processes the message and returns a response
 * that can be relayed back to the platform.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { channelId: string } }
) {
  const channel = getChannel(params.channelId);
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }
  if (!channel.enabled) {
    return NextResponse.json({ error: "Channel is disabled" }, { status: 403 });
  }

  // Verify webhook secret (passed as header or query param)
  const secret =
    req.headers.get("x-webhook-secret") ||
    new URL(req.url).searchParams.get("secret");
  if (!secret || secret !== channel.webhook_secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Normalize the inbound payload — each adapter can parse differently
    const message = extractMessage(channel.channel_type, body);
    if (!message) {
      // Some platforms send verification challenges (e.g., Slack)
      const challenge = body.challenge;
      if (challenge) {
        return NextResponse.json({ challenge });
      }
      return NextResponse.json({ ok: true }); // ACK without processing
    }

    // Create a thread for this channel conversation (or reuse one)
    const threadId = resolveThread(channel.id, message.senderId);

    const result = await runAgentLoop(threadId, message.text);
    const channelConfig = parseConfig(channel.config_json);
    await dispatchOutboundResponse(channel.channel_type, channelConfig, message.senderId, result);

    return NextResponse.json({
      reply: result.content,
      threadId,
      toolsUsed: result.toolsUsed,
      attachments: result.attachments,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Channel ${channel.channel_type}] Webhook error:`, errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

function parseConfig(configJson: string): Record<string, unknown> {
  try {
    return JSON.parse(configJson);
  } catch {
    return {};
  }
}

async function dispatchOutboundResponse(
  channelType: string,
  config: Record<string, unknown>,
  recipientId: string,
  response: AgentResponse
): Promise<void> {
  switch (channelType) {
    case "whatsapp": {
      await sendWhatsAppResponse(config, recipientId, response);
      break;
    }
    default:
      break;
  }
}

const DATA_DIR = path.join(process.cwd(), "data");

async function sendWhatsAppResponse(
  config: Record<string, unknown>,
  to: string,
  response: AgentResponse
): Promise<void> {
  const phoneNumberId = String(
    config.phoneNumberId ?? config.phone_number_id ?? ""
  ).trim();
  const accessToken = String(
    config.accessToken ?? config.access_token ?? ""
  ).trim();
  const apiVersion = String(
    config.apiVersion ?? config.api_version ?? "v19.0"
  ).trim();

  if (!phoneNumberId || !accessToken) {
    console.warn("WhatsApp channel missing phoneNumberId/accessToken.");
    return;
  }

  const baseUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;

  if (response.content && response.content.trim().length > 0) {
    await sendWhatsAppMessage(baseUrl, accessToken, {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: response.content,
      },
    });
  }

  for (const attachment of response.attachments || []) {
    await sendWhatsAppMedia(baseUrl, accessToken, to, attachment);
  }
}

async function sendWhatsAppMessage(
  baseUrl: string,
  token: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("WhatsApp send error:", text);
    }
  } catch (err) {
    console.error("WhatsApp send request failed:", err);
  }
}

async function sendWhatsAppMedia(
  baseUrl: string,
  token: string,
  to: string,
  attachment: AttachmentMeta
): Promise<void> {
  try {
    const absolutePath = resolveAttachmentPath(attachment.storagePath);
    const buffer = await fs.promises.readFile(absolutePath);
    const mimeType = attachment.mimeType || "application/octet-stream";

    const uploadForm = new FormData();
    uploadForm.append("messaging_product", "whatsapp");
    uploadForm.append("type", mimeType);
    uploadForm.append("file", new Blob([buffer]), attachment.filename);

    const uploadRes = await fetch(`${baseUrl}/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: uploadForm,
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      console.error("WhatsApp media upload failed:", text);
      return;
    }

    const uploadJson = await uploadRes.json();
    const mediaId: string | undefined = uploadJson.id;
    if (!mediaId) {
      console.error("WhatsApp media upload missing id.", uploadJson);
      return;
    }

    const messageType = pickWhatsAppMediaType(mimeType);
    const mediaPayload: Record<string, unknown> = { id: mediaId };
    if (messageType === "document") {
      mediaPayload.filename = attachment.filename;
    }

    await sendWhatsAppMessage(baseUrl, token, {
      messaging_product: "whatsapp",
      to,
      type: messageType,
      [messageType]: mediaPayload,
    });
  } catch (err) {
    console.error("WhatsApp media send error:", err);
  }
}

function pickWhatsAppMediaType(mimeType: string): "image" | "video" | "audio" | "document" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

function resolveAttachmentPath(storagePath: string): string {
  const normalized = storagePath
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  const absolute = path.resolve(DATA_DIR, normalized);
  if (!absolute.startsWith(DATA_DIR)) {
    throw new Error("Invalid attachment path");
  }
  return absolute;
}

interface NormalizedMessage {
  text: string;
  senderId: string;
}

function extractMessage(
  channelType: string,
  body: Record<string, unknown>
): NormalizedMessage | null {
  switch (channelType) {
    case "slack": {
      // Slack Events API
      const event = body.event as Record<string, unknown> | undefined;
      if (!event || event.type !== "message" || event.subtype) return null;
      return { text: event.text as string, senderId: event.user as string };
    }
    case "whatsapp": {
      // WhatsApp Cloud API webhook
      const entry = (body.entry as Array<Record<string, unknown>>)?.[0];
      const changes = (entry?.changes as Array<Record<string, unknown>>)?.[0];
      const value = changes?.value as Record<string, unknown> | undefined;
      const msgs = (value?.messages as Array<Record<string, unknown>>)?.[0];
      if (!msgs) return null;
      return {
        text: ((msgs.text as Record<string, unknown>)?.body as string) || "",
        senderId: msgs.from as string,
      };
    }
    case "telegram": {
      const msg = body.message as Record<string, unknown> | undefined;
      if (!msg) return null;
      const from = msg.from as Record<string, unknown>;
      return {
        text: (msg.text as string) || "",
        senderId: String(from?.id || "unknown"),
      };
    }
    case "discord": {
      // Discord interaction/message
      if (body.type === 1) return null; // PING — handled below
      return {
        text: (body.content as string) || "",
        senderId: ((body.author as Record<string, unknown>)?.id as string) || "unknown",
      };
    }
    case "teams": {
      return {
        text: (body.text as string) || "",
        senderId: ((body.from as Record<string, unknown>)?.id as string) || "unknown",
      };
    }
    case "email": {
      // Generic email webhook (e.g., SendGrid Inbound Parse)
      return {
        text: (body.text as string) || (body.subject as string) || "",
        senderId: (body.from as string) || "unknown",
      };
    }
    default:
      // Generic fallback
      if (body.text && typeof body.text === "string") {
        return { text: body.text, senderId: (body.sender as string) || "unknown" };
      }
      return null;
  }
}

/**
 * Finds or creates a thread for a given channel + sender combination.
 */
function resolveThread(channelId: string, senderId: string): string {
  const db = getDb();
  const tag = `channel:${channelId}:${senderId}`;

  // Look for an existing active thread with this tag as the title
  const existing = db
    .prepare("SELECT id FROM threads WHERE title = ? AND status = 'active' ORDER BY last_message_at DESC LIMIT 1")
    .get(tag) as { id: string } | undefined;

  if (existing) return existing.id;

  const id = uuid();
  db.prepare(
    "INSERT INTO threads (id, title, status) VALUES (?, ?, 'active')"
  ).run(id, tag);

  return id;
}
