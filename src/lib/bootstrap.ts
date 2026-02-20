import { initializeDatabase, listMcpServers, addLog, listChannels } from "@/lib/db";
import { startScheduler } from "@/lib/scheduler";
import { getMcpManager } from "@/lib/mcp";
import { startDiscordBot } from "@/lib/channels/discord";

declare global {
  // eslint-disable-next-line no-var
  var __nexus_bootstrapPromise: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __nexus_bootstrapped: boolean | undefined;
}

async function connectConfiguredMcpServers(): Promise<void> {
  const manager = getMcpManager();
  const servers = listMcpServers();
  if (servers.length === 0) return;

  await manager.connectAll();
}

/** Start Discord bots for all enabled Discord channels. */
async function startDiscordBots(): Promise<void> {
  const channels = listChannels();
  const discordChannels = channels.filter(
    (ch) => ch.channel_type === "discord" && ch.enabled
  );

  for (const ch of discordChannels) {
    try {
      const config = JSON.parse(ch.config_json);
      await startDiscordBot(ch.id, config);
    } catch (err) {
      addLog({
        level: "error",
        source: "discord",
        message: `Failed to start Discord bot for channel "${ch.label}": ${err}`,
        metadata: JSON.stringify({ channelId: ch.id }),
      });
    }
  }
}

export async function bootstrapRuntime(): Promise<void> {
  if (globalThis.__nexus_bootstrapped) {
    return;
  }

  if (!globalThis.__nexus_bootstrapPromise) {
    globalThis.__nexus_bootstrapPromise = (async () => {
      initializeDatabase();

      try {
        await connectConfiguredMcpServers();
      } catch (err) {
        addLog({
          level: "error",
          source: "mcp",
          message: `Failed to auto-connect MCP servers: ${err}`,
          metadata: null,
        });
      }

      startScheduler();

      try {
        await startDiscordBots();
      } catch (err) {
        addLog({
          level: "error",
          source: "discord",
          message: `Failed to auto-start Discord bots: ${err}`,
          metadata: null,
        });
      }

      globalThis.__nexus_bootstrapped = true;
    })();
  }

  return globalThis.__nexus_bootstrapPromise;
}
