import { initializeDatabase, listMcpServers, addLog, listChannels } from "@/lib/db";
import { startScheduler } from "@/lib/scheduler";
import { getMcpManager } from "@/lib/mcp";
import { startDiscordBot } from "@/lib/channels/discord";
import { loadCustomToolsFromDb } from "@/lib/agent/custom-tools";

declare global {
   
  var __nexus_bootstrapPromise: Promise<void> | undefined;
   
  var __nexus_bootstrapped: boolean | undefined;
   
  var __nexus_bgServicesPromise: Promise<void> | undefined;

  var __nexus_errorHandlersInstalled: boolean | undefined;
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

/**
 * Start background services (MCP connections, Discord bots) without
 * blocking API route responses.  Called once after the critical path
 * (DB + scheduler) is ready.
 */
function startBackgroundServices(): void {
  if (globalThis.__nexus_bgServicesPromise) return;

  globalThis.__nexus_bgServicesPromise = (async () => {
    try {
      await connectConfiguredMcpServers();
    } catch (err) {
      addLog({
        level: "error",
        source: "mcp",
        message: `Failed to auto-connect MCP servers: ${err}`,
        metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }),
      });
    }

    try {
      loadCustomToolsFromDb();
    } catch (err) {
      addLog({
        level: "error",
        source: "custom-tools",
        message: `Failed to load custom tools: ${err}`,
        metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }),
      });
    }

    try {
      await startDiscordBots();
    } catch (err) {
      addLog({
        level: "error",
        source: "discord",
        message: `Failed to auto-start Discord bots: ${err}`,
        metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }),
      });
    }
  })();
}

export async function bootstrapRuntime(): Promise<void> {
  if (globalThis.__nexus_bootstrapped) {
    return;
  }

  if (!globalThis.__nexus_bootstrapPromise) {
    globalThis.__nexus_bootstrapPromise = (async () => {
      // ── Global error handlers ─────────────────────────────────
      // Prevent unhandled errors from crashing the Node.js process.
      // These fire from background tasks (cron, IMAP, MCP, workers).
      if (!globalThis.__nexus_errorHandlersInstalled) {
        process.on("uncaughtException", (err) => {
          console.error("[Nexus] Uncaught exception (process survived):", err);
          try {
            addLog({
              level: "error",
              source: "process",
              message: `Uncaught exception: ${err?.message || String(err)}`,
              metadata: JSON.stringify({ stack: err?.stack }),
            });
          } catch { /* DB may be unavailable */ }
        });

        process.on("unhandledRejection", (reason) => {
          const msg = reason instanceof Error ? reason.message : String(reason);
          const stack = reason instanceof Error ? reason.stack : undefined;
          console.error("[Nexus] Unhandled promise rejection (process survived):", reason);
          try {
            addLog({
              level: "error",
              source: "process",
              message: `Unhandled promise rejection: ${msg}`,
              metadata: JSON.stringify({ stack }),
            });
          } catch { /* DB may be unavailable */ }
        });

        globalThis.__nexus_errorHandlersInstalled = true;
      }

      // Critical path: DB + scheduler only — fast, no network I/O
      initializeDatabase();
      startScheduler();

      globalThis.__nexus_bootstrapped = true;

      // Fire-and-forget: MCP connections + Discord bots run in background
      startBackgroundServices();
    })();
  }

  return globalThis.__nexus_bootstrapPromise;
}
