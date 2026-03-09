/**
 * Discord Bot Integration (Gateway)
 *
 * Connects to Discord via WebSocket Gateway to support:
 *  - Reply to messages mentioning the bot
 *  - Reply to DMs sent to the bot
 *  - Slash commands (/ask, /help)
 *  - Send attachments/images in responses
 *
 * Bots are started/stopped as channels are enabled/disabled.
 */

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  Partials,
  AttachmentBuilder,
  EmbedBuilder,
  type Message,
  type Interaction,
  ChannelType,
  type Attachment,
} from "discord.js";
import { runAgentLoop, type AgentResponse } from "@/lib/agent";
import type { ContentPart } from "@/lib/llm";
import {
  getDb,
  getChannelOwnerId,
  findActiveChannelThread,
  addLog,
  type AttachmentMeta,
} from "@/lib/db";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";

// ── Active Bot Instances ──────────────────────────────────────

const activeBots = new Map<string, Client>();
const DATA_DIR = path.join(process.cwd(), "data");

// Discord message limit
const DISCORD_MAX_MSG = 2000;
const DISCORD_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DISCORD_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".jfif", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".avif", ".dng", ".raw"]);

// ── Slash Command Definitions ─────────────────────────────────

const SLASH_COMMANDS = [
  {
    name: "ask",
    description: "Ask Nexus AI a question",
    options: [
      {
        name: "question",
        description: "Your question or request",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: "help",
    description: "Show available Nexus commands and capabilities",
  },
];

// ── Public API ────────────────────────────────────────────────

/**
 * Start a Discord bot for a channel configuration.
 */
export async function startDiscordBot(
  channelId: string,
  config: Record<string, unknown>
): Promise<void> {
  // Stop existing bot for this channel if any
  await stopDiscordBot(channelId);

  const botToken = String(config.botToken || "").trim();

  if (!botToken) {
    throw new Error("Discord bot token is required");
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel], // needed to receive DMs
  });

  // ── Event: Ready ──────────────────────────────────────────
  client.once(Events.ClientReady, async (readyClient) => {
    addLog({
      level: "info",
      source: "discord",
      message: `Discord bot connected as ${readyClient.user.tag} for channel ${channelId}`,
      metadata: JSON.stringify({
        channelId,
        botId: readyClient.user.id,
        guildCount: readyClient.guilds.cache.size,
      }),
    });

    // Register slash commands using the application ID from the connected client
    const applicationId = readyClient.application?.id || readyClient.user.id;
    try {
      const rest = new REST({ version: "10" }).setToken(botToken);
      await rest.put(Routes.applicationCommands(applicationId), {
        body: SLASH_COMMANDS,
      });
      addLog({
        level: "info",
        source: "discord",
        message: `Registered slash commands for channel ${channelId}`,
        metadata: JSON.stringify({ channelId, applicationId }),
      });
    } catch (err) {
      addLog({
        level: "error",
        source: "discord",
        message: `Failed to register slash commands: ${err}`,
        metadata: JSON.stringify({ channelId }),
      });
    }
  });

  // ── Event: Message Create ─────────────────────────────────
  client.on(Events.MessageCreate, async (message: Message) => {
    // Ignore own messages
    if (message.author.bot) return;

    const isMention =
      message.mentions.has(client.user!.id) ||
      message.content.startsWith(`<@${client.user!.id}>`);
    const isDM = message.channel.type === ChannelType.DM;

    // Only respond to DMs or mentions
    if (!isDM && !isMention) return;

    // Strip the mention from the text
    let text = message.content
      .replace(new RegExp(`<@!?${client.user!.id}>`, "g"), "")
      .trim();

    const attachmentParts = await buildDiscordImageParts(message.attachments);

    if (!text && attachmentParts.length === 0) {
      text = "Hello!";
    }
    if (!text && attachmentParts.length > 0) {
      text = "Please analyze the attached image(s).";
    }

    try {
      // Show typing indicator
      if ("sendTyping" in message.channel) {
        await message.channel.sendTyping();
      }

      const senderId = message.author.id;
      const userId = getChannelOwnerId(channelId);
      const threadId = resolveThread(channelId, senderId, userId);

      const taggedText = `[External Channel Message from Discord user "${message.author.username}"]\n${text}`;
      const contentParts: ContentPart[] | undefined = attachmentParts.length > 0
        ? [{ type: "text", text }, ...attachmentParts]
        : undefined;
      const result = await runAgentLoop(
        threadId,
        taggedText,
        contentParts,
        undefined,
        undefined,
        userId ?? undefined
      );

      await sendDiscordResponse(message, result);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      addLog({
        level: "error",
        source: "discord",
        message: `Error processing message: ${errorMsg}`,
        metadata: JSON.stringify({ channelId, senderId: message.author.id }),
      });

      try {
        await message.reply("Sorry, I encountered an error processing your message.");
      } catch {
        // Can't reply - channel permissions issue
      }
    }
  });

  // ── Event: Slash Command ──────────────────────────────────
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === "help") {
      const embed = new EmbedBuilder()
        .setTitle("Nexus AI — Help")
        .setDescription("I'm your personal AI assistant. Here's what I can do:")
        .addFields(
          { name: "💬 Chat", value: "Mention me or DM me to chat", inline: true },
          { name: "🔍 Search", value: "I can search the web for current info", inline: true },
          { name: "🌐 Browse", value: "I can navigate websites and fill forms", inline: true },
          { name: "📁 Files", value: "I can read and manage files", inline: true },
          { name: "🧠 Memory", value: "I remember your preferences across chats", inline: true },
          { name: "🛠️ Tools", value: "I connect to external services via MCP", inline: true },
        )
        .addFields({
          name: "Commands",
          value: "`/ask <question>` — Ask me anything\n`/help` — Show this help message",
        })
        .setColor(0x5865f2);

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (commandName === "ask") {
      const question = interaction.options.getString("question", true);

      // Defer reply since agent processing can take time
      await interaction.deferReply();

      try {
        const senderId = interaction.user.id;
        const userId = getChannelOwnerId(channelId);
        const threadId = resolveThread(channelId, senderId, userId);

        const taggedQuestion = `[External Channel Message from Discord user "${interaction.user.username}"]\n${question}`;
        const result = await runAgentLoop(
          threadId,
          taggedQuestion,
          undefined,
          undefined,
          undefined,
          userId ?? undefined
        );

        await sendDiscordInteractionResponse(interaction, result);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        addLog({
          level: "error",
          source: "discord",
          message: `Slash command error: ${errorMsg}`,
          metadata: JSON.stringify({ channelId, senderId: interaction.user.id }),
        });

        await interaction.editReply(
          "Sorry, I encountered an error processing your request."
        );
      }
    }
  });

  // ── Event: Error ──────────────────────────────────────────
  client.on(Events.Error, (error) => {
    addLog({
      level: "error",
      source: "discord",
      message: `Discord client error: ${error.message}`,
      metadata: JSON.stringify({ channelId }),
    });
  });

  // ── Connect ───────────────────────────────────────────────
  await client.login(botToken);
  activeBots.set(channelId, client);

  addLog({
    level: "info",
    source: "discord",
    message: `Discord bot started for channel ${channelId}`,
    metadata: JSON.stringify({ channelId }),
  });
}

async function buildDiscordImageParts(
  attachments: Message["attachments"]
): Promise<Array<{ type: "image_url"; image_url: { url: string; detail: "auto" } }>> {
  if (!attachments || attachments.size === 0) return [];

  const parts: Array<{ type: "image_url"; image_url: { url: string; detail: "auto" } }> = [];

  const items = Array.from(attachments.values());
  for (let i = 0; i < items.length; i++) {
    const attachment = items[i];
    if (!isDiscordImageAttachment(attachment)) continue;
    if (typeof attachment.size === "number" && attachment.size > DISCORD_MAX_IMAGE_BYTES) {
      continue;
    }

    try {
      const res = await fetch(attachment.url);
      if (!res.ok) continue;
      const arrayBuffer = await res.arrayBuffer();
      const mimeType = (attachment.contentType && attachment.contentType.startsWith("image/"))
        ? attachment.contentType
        : guessImageMimeFromName(attachment.name);
      const b64 = Buffer.from(arrayBuffer).toString("base64");
      parts.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${b64}`, detail: "auto" },
      });
    } catch {
      // ignore malformed attachment fetches
    }
  }

  return parts;
}

function isDiscordImageAttachment(att: Attachment): boolean {
  if (att.contentType && att.contentType.startsWith("image/")) return true;
  const name = (att.name || "").toLowerCase();
  return Array.from(DISCORD_IMAGE_EXTENSIONS).some((ext) => name.endsWith(ext));
}

function guessImageMimeFromName(name: string | null): string {
  const lower = (name || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".dng")) return "image/x-adobe-dng";
  return "image/jpeg";
}

/**
 * Stop and disconnect a Discord bot for a channel.
 */
export async function stopDiscordBot(channelId: string): Promise<void> {
  const client = activeBots.get(channelId);
  if (!client) return;

  try {
    client.destroy();
  } catch {
    // Already disconnected
  }

  activeBots.delete(channelId);

  addLog({
    level: "info",
    source: "discord",
    message: `Discord bot stopped for channel ${channelId}`,
    metadata: JSON.stringify({ channelId }),
  });
}

/**
 * Get the number of active Discord bots.
 */
export function getActiveDiscordBotCount(): number {
  return activeBots.size;
}

/**
 * Check if a Discord bot is running for a channel.
 */
export function isDiscordBotActive(channelId: string): boolean {
  const client = activeBots.get(channelId);
  return !!client && client.isReady();
}

/**
 * Stop all active Discord bots (for graceful shutdown).
 */
export async function stopAllDiscordBots(): Promise<void> {
  const channelIds = Array.from(activeBots.keys());
  for (const channelId of channelIds) {
    await stopDiscordBot(channelId);
  }
}

/**
 * Send a direct message to a Discord user via a running channel bot.
 */
export async function sendDiscordDirectMessage(
  channelId: string,
  recipientUserId: string,
  content: string
): Promise<void> {
  const client = activeBots.get(channelId);
  if (!client || !client.isReady()) {
    throw new Error(`Discord bot is not active for channel ${channelId}`);
  }

  const user = await client.users.fetch(recipientUserId);
  await user.send(content);
}

// ── Response Helpers ──────────────────────────────────────────

/**
 * Send an agent response to a Discord message (mention or DM).
 */
async function sendDiscordResponse(
  message: Message,
  response: AgentResponse
): Promise<void> {
  const chunks = splitMessage(response.content);
  const files = buildAttachments(response.attachments);

  // Send text chunks
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    if (i === 0) {
      await message.reply({
        content: chunks[i],
        files: isLast ? files : undefined,
      });
    } else {
      if ("send" in message.channel) {
        await message.channel.send({
          content: chunks[i],
          files: isLast ? files : undefined,
        });
      }
    }
  }

  // If no text but has attachments
  if (chunks.length === 0 && files.length > 0) {
    await message.reply({ files });
  }
}

/**
 * Send an agent response to a deferred slash command interaction.
 */
async function sendDiscordInteractionResponse(
  interaction: Interaction & { editReply: Function },
  response: AgentResponse
): Promise<void> {
  const chunks = splitMessage(response.content);
  const files = buildAttachments(response.attachments);

  if (chunks.length === 0) {
    await interaction.editReply({
      content: "*(No response)*",
      files,
    });
    return;
  }

  // First chunk as the deferred reply edit
  await interaction.editReply({
    content: chunks[0],
    files: chunks.length === 1 ? files : undefined,
  });

  // Additional chunks as follow-up messages
  if ("followUp" in interaction) {
    for (let i = 1; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      await (interaction as any).followUp({
        content: chunks[i],
        files: isLast ? files : undefined,
      });
    }
  }
}

/**
 * Split a long message into Discord-friendly chunks (≤2000 chars).
 */
function splitMessage(content: string): string[] {
  if (!content || content.trim().length === 0) return [];
  if (content.length <= DISCORD_MAX_MSG) return [content];

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_MSG) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point (newline, sentence break, or word boundary)
    let splitAt = DISCORD_MAX_MSG;

    // Try splitting at a double newline
    const doubleNewline = remaining.lastIndexOf("\n\n", DISCORD_MAX_MSG);
    if (doubleNewline > DISCORD_MAX_MSG * 0.5) {
      splitAt = doubleNewline;
    } else {
      // Try single newline
      const newline = remaining.lastIndexOf("\n", DISCORD_MAX_MSG);
      if (newline > DISCORD_MAX_MSG * 0.5) {
        splitAt = newline;
      } else {
        // Try space
        const space = remaining.lastIndexOf(" ", DISCORD_MAX_MSG);
        if (space > DISCORD_MAX_MSG * 0.5) {
          splitAt = space;
        }
      }
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Convert agent attachments to Discord AttachmentBuilder instances.
 */
function buildAttachments(
  attachments: AttachmentMeta[] | undefined
): AttachmentBuilder[] {
  if (!attachments || attachments.length === 0) return [];

  return attachments
    .map((att) => {
      try {
        const absPath = resolveAttachmentPath(att.storagePath);
        if (!fs.existsSync(absPath)) return null;
        const buffer = fs.readFileSync(absPath);
        return new AttachmentBuilder(buffer, { name: att.filename });
      } catch {
        return null;
      }
    })
    .filter(Boolean) as AttachmentBuilder[];
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

// ── Thread Resolution ─────────────────────────────────────────

/**
 * Find or create a thread for a Discord channel + sender combination.
 */
function resolveThread(
  channelId: string,
  senderId: string,
  userId: string | null
): string {
  const db = getDb();
  const existing = findActiveChannelThread(channelId, senderId, userId);
  if (existing?.id) return existing.id;

  const id = uuid();
  db.prepare(
    `INSERT INTO threads (id, user_id, title, thread_type, is_interactive, channel_id, external_sender_id, status)
     VALUES (?, ?, ?, 'channel', 0, ?, ?, 'active')`
  ).run(id, userId, `Channel message from ${senderId}`, channelId, senderId);

  return id;
}
