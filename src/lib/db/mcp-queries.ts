import { getDb, cachedStmt as _cachedStmt } from "./connection";
import { encryptField, decryptField } from "./crypto";
import { appCache, CACHE_KEYS } from "@/lib/cache";

/** Thin wrapper that passes the (patchable) `getDb` import to the cache */
function stmt(sql: string) { return _cachedStmt(sql, getDb); }

export interface McpServerRecord {
  id: string;
  name: string;
  transport_type: string | null;
  command: string | null;
  args: string | null;
  env_vars: string | null;
  url: string | null;
  auth_type: string | null;
  access_token: string | null;
  client_id: string | null;
  client_secret: string | null;
  user_id: string | null;
  scope: string;
}

/** Decrypt sensitive MCP server fields after reading from DB */
function decryptMcpServer(srv: McpServerRecord | undefined): McpServerRecord | undefined {
  if (!srv) return undefined;
  return {
    ...srv,
    access_token: decryptField(srv.access_token) as string | null,
    client_secret: decryptField(srv.client_secret) as string | null,
  };
}

/** List servers visible to a user: their own + global ones */
export function listMcpServers(userId?: string): McpServerRecord[] {
  const cacheKey = `${CACHE_KEYS.MCP_SERVERS_PREFIX}${userId ?? "_all"}`;
  return appCache.get(cacheKey, () => {
    const rows = userId
      ? getDb()
          .prepare("SELECT * FROM mcp_servers WHERE user_id IS NULL OR scope = 'global' OR user_id = ?")
          .all(userId) as McpServerRecord[]
      : getDb().prepare("SELECT * FROM mcp_servers").all() as McpServerRecord[];
    return rows.map((r) => decryptMcpServer(r)!);
  });
}

export function getMcpServer(id: string): McpServerRecord | undefined {
  const row = stmt("SELECT * FROM mcp_servers WHERE id = ?").get(id) as McpServerRecord | undefined;
  return decryptMcpServer(row);
}

export function upsertMcpServer(server: McpServerRecord): void {
  getDb()
    .prepare(
      `INSERT INTO mcp_servers (id, name, transport_type, command, args, env_vars, url, auth_type, access_token, client_id, client_secret, user_id, scope)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name,
         transport_type = excluded.transport_type,
         command = excluded.command,
         args = excluded.args,
         env_vars = excluded.env_vars,
         url = excluded.url,
         auth_type = excluded.auth_type,
         access_token = excluded.access_token,
         client_id = excluded.client_id,
         client_secret = excluded.client_secret,
         user_id = excluded.user_id,
         scope = excluded.scope`
    )
    .run(
      server.id, server.name, server.transport_type, server.command,
      server.args, server.env_vars, server.url ?? null,
      server.auth_type ?? "none", encryptField(server.access_token ?? null),
      server.client_id ?? null, encryptField(server.client_secret ?? null),
      server.user_id ?? null, server.scope ?? "global"
    );
  appCache.invalidatePrefix(CACHE_KEYS.MCP_SERVERS_PREFIX);
}

export function deleteMcpServer(id: string): void {
  const db = getDb();
  // Remove tool policies that reference this server to avoid FK constraint errors
  db.prepare("DELETE FROM tool_policies WHERE mcp_id = ?").run(id);
  db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
  appCache.invalidatePrefix(CACHE_KEYS.MCP_SERVERS_PREFIX);
}
