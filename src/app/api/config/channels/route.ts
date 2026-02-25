import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  getChannel,
  type ChannelType,
} from "@/lib/db";
import { startDiscordBot, stopDiscordBot, isDiscordBotActive } from "@/lib/channels/discord";

const VALID_CHANNEL_TYPES: ChannelType[] = [
  "whatsapp",
  "slack",
  "email",
  "telegram",
  "discord",
  "teams",
];

function maskSecrets(configJson: string): string {
  try {
    const config = JSON.parse(configJson);
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (
        typeof value === "string" &&
        (key.toLowerCase().includes("token") ||
          key.toLowerCase().includes("secret") ||
          key.toLowerCase().includes("password") ||
          key.toLowerCase().includes("key"))
      ) {
        masked[key] = value.length > 0 ? "••••••" : "";
      } else {
        masked[key] = value;
      }
    }
    return JSON.stringify(masked);
  } catch {
    return configJson;
  }
}

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const channels = listChannels(auth.user.id).map((ch) => ({
    ...ch,
    config_json: maskSecrets(ch.config_json),
    discord_bot_active: ch.channel_type === "discord" ? isDiscordBotActive(ch.id) : undefined,
  }));

  return NextResponse.json(channels);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { label, channelType, config } = body;

  if (!label || !channelType || !config) {
    return NextResponse.json(
      { error: "label, channelType, and config are required." },
      { status: 400 }
    );
  }
  // Validate label length to prevent abuse
  if (typeof label !== "string" || label.length > 100) {
    return NextResponse.json(
      { error: "label must be a string of 100 characters or less." },
      { status: 400 }
    );
  }
  if (typeof config !== "object" || config === null) {
    return NextResponse.json(
      { error: "config must be a valid object." },
      { status: 400 }
    );
  }
  if (!VALID_CHANNEL_TYPES.includes(channelType)) {
    return NextResponse.json(
      { error: `Invalid channelType. Must be one of: ${VALID_CHANNEL_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  const record = createChannel({
    label,
    channelType,
    configJson: JSON.stringify(config),
    userId: auth.user.id,
  });

  // Auto-start Discord bot when channel is created
  if (channelType === "discord") {
    try {
      await startDiscordBot(record.id, config);
    } catch (err) {
      // Channel created but bot failed to start — log it
      console.error("Discord bot start failed:", err);
    }
  }

  return NextResponse.json(
    { ...record, config_json: maskSecrets(record.config_json) },
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { id, label, channelType, config, enabled } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  // Ensure user owns this channel
  const existing = getChannel(id);
  if (!existing || existing.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }
  if (channelType && !VALID_CHANNEL_TYPES.includes(channelType)) {
    return NextResponse.json(
      { error: `Invalid channelType. Must be one of: ${VALID_CHANNEL_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  const updated = updateChannel({
    id,
    label,
    channelType,
    configJson: config ? JSON.stringify(config) : undefined,
    enabled,
  });

  if (!updated) {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }

  // Manage Discord bot lifecycle on enable/disable/config change
  const effectiveType = channelType || updated.channel_type;
  if (effectiveType === "discord") {
    if (updated.enabled) {
      try {
        const cfg = JSON.parse(updated.config_json);
        await startDiscordBot(id, cfg);
      } catch (err) {
        console.error("Discord bot restart failed:", err);
      }
    } else {
      await stopDiscordBot(id);
    }
  }

  return NextResponse.json({ ...updated, config_json: maskSecrets(updated.config_json) });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id query param is required." }, { status: 400 });
  }

  // Ensure user owns this channel
  const channel = getChannel(id);
  if (!channel || channel.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }

  // Stop Discord bot before deleting channel
  if (channel.channel_type === "discord") {
    await stopDiscordBot(id);
  }

  deleteChannel(id);
  return NextResponse.json({ success: true });
}
