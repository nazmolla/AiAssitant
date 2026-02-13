import { initializeDatabase, listMcpServers, addLog } from "@/lib/db";
import { startScheduler } from "@/lib/scheduler";
import { getMcpManager } from "@/lib/mcp";

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
      globalThis.__nexus_bootstrapped = true;
    })();
  }

  return globalThis.__nexus_bootstrapPromise;
}
