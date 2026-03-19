import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { listMcpServers, type McpServerRecord } from "@/lib/db";
import { addLog } from "@/lib/db";
import type { ToolDefinition } from "@/lib/llm";
import { MCP_CONNECT_TIMEOUT_MS } from "@/lib/constants";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("mcp.manager");

/** OpenAI API enforces max 64 characters for tool function names. */
export const MAX_TOOL_NAME_LENGTH = 64;

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
 * Build a qualified tool name `serverId.toolName` that fits within
 * MAX_TOOL_NAME_LENGTH. If the combined name exceeds the limit,
 * truncate the tool-name portion. A reverse map is maintained so
 * callTool can recover the original MCP tool name.
 */
export function qualifyToolName(
  serverId: string,
  toolName: string,
  reverseMap: Map<string, string>,
): string {
  const qualified = `${serverId}.${toolName}`;
  if (qualified.length <= MAX_TOOL_NAME_LENGTH) {
    return qualified;
  }
  // Truncate tool-name portion: prefix.toolNameTrunc
  const prefixLen = serverId.length + 1; // "serverId."
  const maxToolLen = MAX_TOOL_NAME_LENGTH - prefixLen;
  if (maxToolLen < 1) {
    // Server ID itself is too long (shouldn't happen with UUIDs)
    const truncated = qualified.substring(0, MAX_TOOL_NAME_LENGTH);
    reverseMap.set(truncated, toolName);
    return truncated;
  }
  const truncatedToolName = toolName.substring(0, maxToolLen);
  const shortQualified = `${serverId}.${truncatedToolName}`;
  reverseMap.set(shortQualified, toolName);
  return shortQualified;
}

/**
 * MCP Manager: connects to configured MCP servers, discovers tools,
 * and provides a unified interface for tool invocation.
 */
class McpManager {
  private connections = new Map<string, ConnectedMcpServer>();
  /** Maps truncated qualified names back to original MCP tool names. */
  private toolNameMap = new Map<string, string>();

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
   * Build a Client with listChanged.tools handler that auto-refreshes
   * the connection's tool list when the server emits list_changed.
   */
  private createClient(server: McpServerRecord): Client {
    return new Client(
      { name: "nexus-agent", version: "1.0.0" },
      {
        capabilities: {},
        listChanged: {
          tools: {
            autoRefresh: true,
            debounceMs: 500,
            onChanged: (err: Error | null, tools: Tool[] | null) => {
              if (err) {
                addLog({
                  level: "error",
                  source: "mcp",
                  message: `Failed to refresh tools for "${server.name}" after list_changed: ${err.message}`,
                  metadata: JSON.stringify({ serverId: server.id }),
                });
                return;
              }
              const conn = this.connections.get(server.id);
              if (!conn || !tools) return;

              const oldCount = conn.tools.length;
              conn.tools = tools.map((t) => ({
                name: qualifyToolName(server.id, t.name, this.toolNameMap),
                description: t.description || "",
                inputSchema: (t.inputSchema as Record<string, unknown>) || {},
              }));

              addLog({
                level: "info",
                source: "mcp",
                message: `MCP server "${server.name}" tools refreshed: ${oldCount} → ${conn.tools.length} tools.`,
                metadata: JSON.stringify({ tools: conn.tools.map((t) => t.name) }),
              });
            },
          },
        },
      }
    );
  }

  /**
   * Connect to a single MCP server.
   */
  async connect(server: McpServerRecord): Promise<ConnectedMcpServer> {
    const t0 = Date.now();
    log.enter("connect", { serverId: server.id, serverName: server.name });
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

    let client = this.createClient(server);

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
      await withTimeout(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, server.name);
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
      await withTimeout(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, server.name);
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
        await withTimeout(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, server.name);
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
          client = this.createClient(server);
          const sseTransport = new SSEClientTransport(new URL(endpoint), {
            requestInit: { headers: httpHeaders },
          } as any);
          await withTimeout(client.connect(sseTransport), MCP_CONNECT_TIMEOUT_MS, server.name);
        } catch (_sseErr) {
          // Last resort: try SSE at endpoint + /sse (legacy MCP convention)
          addLog({
            level: "info",
            source: "mcp",
            message: `SSE at original URL failed for "${server.name}", trying /sse suffix: ${_sseErr}`,
            metadata: JSON.stringify({ serverId: server.id }),
          });
          client = this.createClient(server);
          const sseUrl = endpoint.replace(/\/$/, "") + "/sse";
          const sseTransport2 = new SSEClientTransport(new URL(sseUrl), {
            requestInit: { headers: httpHeaders },
          } as any);
          await withTimeout(client.connect(sseTransport2), MCP_CONNECT_TIMEOUT_MS, server.name);
        }
      }
    } else {
      throw new Error(`Transport type "${transportType}" not supported.`);
    }

    // Discover tools
    const toolsResult = await client.listTools();
    const tools: ToolDefinition[] = toolsResult.tools.map((t) => ({
      name: qualifyToolName(server.id, t.name, this.toolNameMap),
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
    log.exit("connect", { serverId: server.id, toolCount: tools.length }, Date.now() - t0);

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
   * Disconnect all MCP servers and clear internal state.
   */
  async disconnectAll(): Promise<void> {
    for (const id of Array.from(this.connections.keys())) {
      await this.disconnect(id);
    }
    this.toolNameMap.clear();
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
   * If the name was truncated during qualification, the reverse map resolves it.
   */
  async callTool(
    qualifiedName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const t0 = Date.now();
    log.enter("callTool", { qualifiedName });
    const dotIndex = qualifiedName.indexOf(".");
    if (dotIndex === -1) {
      throw new Error(`Invalid tool name format: "${qualifiedName}". Expected "serverId.toolName".`);
    }

    const serverId = qualifiedName.substring(0, dotIndex);
    // Resolve truncated name back to original if needed
    const toolName = this.toolNameMap.get(qualifiedName)
      ?? qualifiedName.substring(dotIndex + 1);

    const conn = this.connections.get(serverId);
    if (!conn) {
      throw new Error(`MCP server "${serverId}" is not connected.`);
    }

    const result = await conn.client.callTool({ name: toolName, arguments: args });
    log.exit("callTool", { qualifiedName }, Date.now() - t0);
    return result;
  }

  /**
   * Get the list of connected server IDs.
   */
  getConnectedServerIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get connected servers with display name and tool count.
   * Used to inject context into the agent system prompt.
   */
  getConnectedServers(): Array<{ id: string; name: string; toolCount: number }> {
    return Array.from(this.connections.entries()).map(([id, conn]) => ({
      id,
      name: conn.record.name,
      toolCount: conn.tools.length,
    }));
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

/** Reset the singleton MCP manager (disconnects all servers, destroys instance). */
export async function resetMcpManager(): Promise<void> {
  if (_manager) {
    await _manager.disconnectAll();
    _manager = null;
  }
}
