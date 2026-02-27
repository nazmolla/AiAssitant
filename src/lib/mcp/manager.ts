import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { listMcpServers, type McpServerRecord } from "@/lib/db";
import { addLog } from "@/lib/db";
import type { ToolDefinition } from "@/lib/llm";

/** Per-server connection timeout (ms). */
const CONNECT_TIMEOUT_MS = 15_000;

/** Race a promise against a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Connection to "${label}" timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export interface ConnectedMcpServer {
  record: McpServerRecord;
  client: Client;
  tools: ToolDefinition[];
}

/**
 * MCP Manager: connects to configured MCP servers, discovers tools,
 * and provides a unified interface for tool invocation.
 */
class McpManager {
  private connections = new Map<string, ConnectedMcpServer>();

  /**
   * Connect to all configured MCP servers from the database.
   * Connections run in parallel with individual timeouts.
   */
  async connectAll(): Promise<void> {
    const servers = listMcpServers();
    if (servers.length === 0) return;

    const results = await Promise.allSettled(
      servers.map((server) => this.connect(server))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        addLog({
          level: "error",
          source: "mcp",
          message: `Failed to connect to MCP server "${servers[i].name}": ${result.reason}`,
          metadata: JSON.stringify({ serverId: servers[i].id }),
        });
      }
    }
  }

  /**
   * Connect to a single MCP server.
   */
  async connect(server: McpServerRecord): Promise<ConnectedMcpServer> {
    // Disconnect existing connection if any
    if (this.connections.has(server.id)) {
      await this.disconnect(server.id);
    }

    const args = server.args ? JSON.parse(server.args) : [];
    const rawEnvVars = server.env_vars ? JSON.parse(server.env_vars) : {};

    // Filter out dangerous environment variable overrides that could enable
    // code injection or library preloading attacks
    const BLOCKED_ENV_VARS = new Set([
      "PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
      "DYLD_LIBRARY_PATH", "NODE_OPTIONS", "PYTHONSTARTUP", "RUBYOPT",
      "PERL5OPT", "JAVA_TOOL_OPTIONS", "CLASSPATH",
    ]);
    const envVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawEnvVars)) {
      if (!BLOCKED_ENV_VARS.has(key.toUpperCase())) {
        envVars[key] = value as string;
      } else {
        addLog({
          level: "warn",
          source: "mcp",
          message: `Blocked dangerous env var override "${key}" for MCP server "${server.name}".`,
          metadata: JSON.stringify({ serverId: server.id }),
        });
      }
    }

    let client = new Client(
      { name: "nexus-agent", version: "1.0.0" },
      { capabilities: {} }
    );

    const transportType = server.transport_type || "stdio";

    // Build auth headers for HTTP-based transports
    const authHeaders: Record<string, string> = {};
    if (server.auth_type === "bearer" && server.access_token) {
      authHeaders["Authorization"] = `Bearer ${server.access_token}`;
    }

    if (transportType === "stdio") {
      if (!server.command) {
        throw new Error("stdio transport requires the command field.");
      }
      // Only pass safe environment variables to child processes — never leak
      // secrets like DB passwords, auth tokens, or encryption keys.
      const SAFE_ENV_VARS = [
        "PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
        "TERM", "TMPDIR", "TMP", "TEMP", "HOSTNAME",
        "NODE_ENV", "XDG_RUNTIME_DIR", "XDG_DATA_HOME", "XDG_CONFIG_HOME",
      ];
      const safeEnv: Record<string, string> = {};
      for (const key of SAFE_ENV_VARS) {
        if (process.env[key]) safeEnv[key] = process.env[key]!;
      }
      const transport = new StdioClientTransport({
        command: server.command,
        args,
        env: { ...safeEnv, ...envVars } as Record<string, string>,
      });
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, server.name);
    } else if (transportType === "sse") {
      const endpoint = server.url || server.command;
      if (!endpoint) {
        throw new Error("SSE transport requires a URL or command field with a valid URL.");
      }
      const transport = new SSEClientTransport(new URL(endpoint), {
        requestInit: {
          headers: { ...envVars, ...authHeaders } as Record<string, string>,
        },
      } as any);
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, server.name);
    } else if (transportType === "streamablehttp") {
      const endpoint = server.url || server.command;
      if (!endpoint) {
        throw new Error("Streamable HTTP transport requires a URL.");
      }
      const httpHeaders = { ...envVars, ...authHeaders } as Record<string, string>;
      try {
        const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
          requestInit: { headers: httpHeaders },
        });
        await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, server.name);
      } catch (streamErr) {
        // Fallback to SSE if StreamableHTTP fails (e.g. 404 — server uses legacy SSE)
        addLog({
          level: "info",
          source: "mcp",
          message: `StreamableHTTP failed for "${server.name}", falling back to SSE: ${streamErr}`,
          metadata: JSON.stringify({ serverId: server.id }),
        });

        // Try SSE at the original URL first (some servers use SSE at the same endpoint)
        try {
          client = new Client(
            { name: "nexus-agent", version: "1.0.0" },
            { capabilities: {} }
          );
          const sseTransport = new SSEClientTransport(new URL(endpoint), {
            requestInit: { headers: httpHeaders },
          } as any);
          await withTimeout(client.connect(sseTransport), CONNECT_TIMEOUT_MS, server.name);
        } catch (_sseErr) {
          // Last resort: try SSE at endpoint + /sse (legacy MCP convention)
          addLog({
            level: "info",
            source: "mcp",
            message: `SSE at original URL failed for "${server.name}", trying /sse suffix: ${_sseErr}`,
            metadata: JSON.stringify({ serverId: server.id }),
          });
          client = new Client(
            { name: "nexus-agent", version: "1.0.0" },
            { capabilities: {} }
          );
          const sseUrl = endpoint.replace(/\/$/, "") + "/sse";
          const sseTransport2 = new SSEClientTransport(new URL(sseUrl), {
            requestInit: { headers: httpHeaders },
          } as any);
          await withTimeout(client.connect(sseTransport2), CONNECT_TIMEOUT_MS, server.name);
        }
      }
    } else {
      throw new Error(`Transport type "${transportType}" not supported.`);
    }

    // Discover tools
    const toolsResult = await client.listTools();
    const tools: ToolDefinition[] = toolsResult.tools.map((t) => ({
      name: `${server.id}.${t.name}`,
      description: t.description || "",
      inputSchema: (t.inputSchema as Record<string, unknown>) || {},
    }));

    const connection: ConnectedMcpServer = { record: server, client, tools };
    this.connections.set(server.id, connection);

    addLog({
      level: "info",
      source: "mcp",
      message: `Connected to MCP server "${server.name}" with ${tools.length} tools.`,
      metadata: JSON.stringify({ tools: tools.map((t) => t.name) }),
    });

    return connection;
  }

  /**
   * Disconnect a specific MCP server.
   */
  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (conn) {
      await conn.client.close();
      this.connections.delete(serverId);
    }
  }

  /**
   * Disconnect all MCP servers.
   */
  async disconnectAll(): Promise<void> {
    for (const id of Array.from(this.connections.keys())) {
      await this.disconnect(id);
    }
  }

  /**
   * Get all available tools across all connected MCP servers.
   */
  getAllTools(): ToolDefinition[] {
    const all: ToolDefinition[] = [];
    for (const conn of Array.from(this.connections.values())) {
      all.push(...conn.tools);
    }
    return all;
  }

  /**
   * Call a tool on the appropriate MCP server.
   * Tool names are prefixed with the server ID: `serverId.toolName`
   */
  async callTool(
    qualifiedName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const dotIndex = qualifiedName.indexOf(".");
    if (dotIndex === -1) {
      throw new Error(`Invalid tool name format: "${qualifiedName}". Expected "serverId.toolName".`);
    }

    const serverId = qualifiedName.substring(0, dotIndex);
    const toolName = qualifiedName.substring(dotIndex + 1);

    const conn = this.connections.get(serverId);
    if (!conn) {
      throw new Error(`MCP server "${serverId}" is not connected.`);
    }

    const result = await conn.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  /**
   * Get the list of connected server IDs.
   */
  getConnectedServerIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Check if a server is connected.
   */
  isConnected(serverId: string): boolean {
    return this.connections.has(serverId);
  }
}

// Singleton instance
let _manager: McpManager | null = null;

export function getMcpManager(): McpManager {
  if (!_manager) {
    _manager = new McpManager();
  }
  return _manager;
}
