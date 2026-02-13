import { NextRequest, NextResponse } from "next/server";
import { getChannel } from "@/lib/db";
import { runAgentLoop } from "@/lib/agent";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";

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

    return NextResponse.json({
      reply: result.content,
      threadId,
      toolsUsed: result.toolsUsed,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Channel ${channel.channel_type}] Webhook error:`, errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
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
