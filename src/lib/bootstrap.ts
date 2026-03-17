import { listMcpServers, addLog, listChannels, getDb } from "@/lib/db";
import { initializeDatabase } from "@/lib/db/init";
import { startUnifiedSchedulerEngine } from "@/lib/scheduler/unified-engine";
import { getMcpManager } from "@/lib/mcp";
import { startDiscordBot } from "@/lib/channels/discord-channel";
import { loadCustomToolsFromDb } from "@/lib/tools/custom-tools";

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
 * One-time cleanup for legacy migrated run-once schedules that were owned by
 * the old system scheduler.
 */
function cleanupLegacySystemRunOnceSchedulesOnce(): void {
  const db = getDb();
  const cleanupKey = "scheduler.cleanup_legacy_system_once_v1";

  try {
    const marker = db.prepare("SELECT value FROM app_config WHERE key = ?").get(cleanupKey) as { value?: string } | undefined;
    if (marker?.value === "1") return;

    const deleted = db.prepare(
      `DELETE FROM scheduler_schedules
       WHERE trigger_type = 'once'
         AND owner_type = 'system'`
    ).run();

    db.prepare(
      `INSERT INTO app_config (key, value, updated_at)
       VALUES (?, '1', CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP`
    ).run(cleanupKey);

    const removed = Number(deleted.changes || 0);
    if (removed > 0) {
      addLog({
        level: "info",
        source: "scheduler.cleanup",
        message: "Removed legacy system run-once schedules during one-time startup cleanup.",
        metadata: JSON.stringify({ removed, cleanupKey }),
      });
    }
  } catch (err) {
    addLog({
      level: "warning",
      source: "scheduler.cleanup",
      message: `Legacy run-once schedule cleanup failed: ${err}`,
      metadata: JSON.stringify({ cleanupKey }),
    });
  }
}

/**
 * Start background services (MCP connections, custom tools) without
 * blocking API route responses.  Called once after the critical path
 * (DB + scheduler + Discord bots) is ready.
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

      // Critical path: DB + scheduler + Discord bots — fast, no network I/O
      initializeDatabase();
      cleanupLegacySystemRunOnceSchedulesOnce();
      startUnifiedSchedulerEngine();
      await startDiscordBots();

      globalThis.__nexus_bootstrapped = true;

      // Fire-and-forget: MCP connections + custom tools run in background
      startBackgroundServices();
    })();
  }

  return globalThis.__nexus_bootstrapPromise;
}

