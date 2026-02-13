import { getDb } from "./connection";
import { v4 as uuid } from "uuid";

// ─── Identity ────────────────────────────────────────────────

export interface IdentityConfig {
  id: number;
  owner_email: string;
  provider_id: string;
  external_sub_id: string | null;
  password_hash: string | null;
  api_keys_encrypted: string | null;
}

export function getIdentity(): IdentityConfig | undefined {
  return getDb().prepare("SELECT * FROM identity_config WHERE id = 1").get() as IdentityConfig | undefined;
}

interface UpsertIdentityArgs {
  email: string;
  providerId: string;
  subId: string | null;
  passwordHash?: string | null;
}

export function upsertIdentity({ email, providerId, subId, passwordHash = null }: UpsertIdentityArgs): void {
  getDb()
    .prepare(
      `INSERT INTO identity_config (id, owner_email, provider_id, external_sub_id, password_hash)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET owner_email = excluded.owner_email,
         provider_id = excluded.provider_id,
         external_sub_id = excluded.external_sub_id,
         password_hash = CASE
           WHEN excluded.password_hash IS NULL THEN identity_config.password_hash
           ELSE excluded.password_hash
         END`
    )
    .run(email, providerId, subId, passwordHash);
}

// ─── MCP Servers ─────────────────────────────────────────────

export interface McpServerRecord {
  id: string;
  name: string;
  transport_type: string | null;
  command: string;
  args: string | null;
  env_vars: string | null;
}

export function listMcpServers(): McpServerRecord[] {
  return getDb().prepare("SELECT * FROM mcp_servers").all() as McpServerRecord[];
}

export function getMcpServer(id: string): McpServerRecord | undefined {
  return getDb().prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as McpServerRecord | undefined;
}

export function upsertMcpServer(server: McpServerRecord): void {
  getDb()
    .prepare(
      `INSERT INTO mcp_servers (id, name, transport_type, command, args, env_vars)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name,
         transport_type = excluded.transport_type,
         command = excluded.command,
         args = excluded.args,
         env_vars = excluded.env_vars`
    )
    .run(server.id, server.name, server.transport_type, server.command, server.args, server.env_vars);
}

export function deleteMcpServer(id: string): void {
  getDb().prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
}

// ─── User Knowledge ──────────────────────────────────────────

export interface KnowledgeEntry {
  id: number;
  entity: string;
  attribute: string;
  value: string;
  source_context: string | null;
  last_updated: string;
}

export function listKnowledge(): KnowledgeEntry[] {
  return getDb().prepare("SELECT * FROM user_knowledge ORDER BY last_updated DESC").all() as KnowledgeEntry[];
}

export function searchKnowledge(query: string): KnowledgeEntry[] {
  return getDb()
    .prepare(
      `SELECT * FROM user_knowledge
       WHERE entity LIKE ? OR attribute LIKE ? OR value LIKE ?
       ORDER BY last_updated DESC`
    )
    .all(`%${query}%`, `%${query}%`, `%${query}%`) as KnowledgeEntry[];
}

export function upsertKnowledge(entry: Omit<KnowledgeEntry, "id" | "last_updated">): void {
  getDb()
    .prepare(
      `INSERT INTO user_knowledge (entity, attribute, value, source_context)
       VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`
    )
    .run(entry.entity, entry.attribute, entry.value, entry.source_context);
}

export function updateKnowledge(id: number, entry: Partial<Pick<KnowledgeEntry, "entity" | "attribute" | "value">>): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (entry.entity !== undefined) { sets.push("entity = ?"); vals.push(entry.entity); }
  if (entry.attribute !== undefined) { sets.push("attribute = ?"); vals.push(entry.attribute); }
  if (entry.value !== undefined) { sets.push("value = ?"); vals.push(entry.value); }
  sets.push("last_updated = CURRENT_TIMESTAMP");
  vals.push(id);
  getDb().prepare(`UPDATE user_knowledge SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function deleteKnowledge(id: number): void {
  getDb().prepare("DELETE FROM user_knowledge WHERE id = ?").run(id);
}

// ─── Threads ─────────────────────────────────────────────────

export interface Thread {
  id: string;
  title: string | null;
  status: string;
  last_message_at: string;
}

export function createThread(title?: string): Thread {
  const id = uuid();
  getDb()
    .prepare("INSERT INTO threads (id, title) VALUES (?, ?)")
    .run(id, title || "New Thread");
  return getDb().prepare("SELECT * FROM threads WHERE id = ?").get(id) as Thread;
}

export function listThreads(): Thread[] {
  return getDb().prepare("SELECT * FROM threads ORDER BY last_message_at DESC").all() as Thread[];
}

export function getThread(id: string): Thread | undefined {
  return getDb().prepare("SELECT * FROM threads WHERE id = ?").get(id) as Thread | undefined;
}

export function updateThreadStatus(id: string, status: string): void {
  getDb().prepare("UPDATE threads SET status = ? WHERE id = ?").run(status, id);
}

// ─── Messages ────────────────────────────────────────────────

export interface Message {
  id: number;
  thread_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls: string | null;
  tool_results: string | null;
}

export function addMessage(msg: Omit<Message, "id">): Message {
  const result = getDb()
    .prepare(
      `INSERT INTO messages (thread_id, role, content, tool_calls, tool_results)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(msg.thread_id, msg.role, msg.content, msg.tool_calls, msg.tool_results);

  getDb()
    .prepare("UPDATE threads SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(msg.thread_id);

  return getDb().prepare("SELECT * FROM messages WHERE id = ?").get(result.lastInsertRowid) as Message;
}

export function getThreadMessages(threadId: string): Message[] {
  return getDb()
    .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY id ASC")
    .all(threadId) as Message[];
}

// ─── Tool Policies ───────────────────────────────────────────

export interface ToolPolicy {
  tool_name: string;
  mcp_id: string | null;
  requires_approval: number;
  is_proactive_enabled: number;
}

export function listToolPolicies(): ToolPolicy[] {
  return getDb().prepare("SELECT * FROM tool_policies").all() as ToolPolicy[];
}

export function getToolPolicy(toolName: string): ToolPolicy | undefined {
  return getDb().prepare("SELECT * FROM tool_policies WHERE tool_name = ?").get(toolName) as ToolPolicy | undefined;
}

export function upsertToolPolicy(policy: ToolPolicy): void {
  getDb()
    .prepare(
      `INSERT INTO tool_policies (tool_name, mcp_id, requires_approval, is_proactive_enabled)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tool_name) DO UPDATE SET
         mcp_id = excluded.mcp_id,
         requires_approval = excluded.requires_approval,
         is_proactive_enabled = excluded.is_proactive_enabled`
    )
    .run(policy.tool_name, policy.mcp_id, policy.requires_approval, policy.is_proactive_enabled);
}

// ─── Approval Queue ──────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  thread_id: string | null;
  tool_name: string;
  args: string;
  reasoning: string | null;
  status: string;
  created_at: string;
}

export function createApprovalRequest(req: Omit<ApprovalRequest, "id" | "status" | "created_at">): ApprovalRequest {
  const id = uuid();
  getDb()
    .prepare(
      `INSERT INTO approval_queue (id, thread_id, tool_name, args, reasoning)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, req.thread_id, req.tool_name, req.args, req.reasoning);
  return getDb().prepare("SELECT * FROM approval_queue WHERE id = ?").get(id) as ApprovalRequest;
}

export function listPendingApprovals(): ApprovalRequest[] {
  return getDb()
    .prepare("SELECT * FROM approval_queue WHERE status = 'pending' ORDER BY created_at DESC")
    .all() as ApprovalRequest[];
}

export function updateApprovalStatus(id: string, status: "approved" | "rejected"): void {
  getDb().prepare("UPDATE approval_queue SET status = ? WHERE id = ?").run(status, id);
}

// ─── Agent Logs ──────────────────────────────────────────────

export interface AgentLog {
  id: number;
  level: string;
  source: string | null;
  message: string;
  metadata: string | null;
  created_at: string;
}

export function addLog(log: Omit<AgentLog, "id" | "created_at">): void {
  getDb()
    .prepare(
      `INSERT INTO agent_logs (level, source, message, metadata) VALUES (?, ?, ?, ?)`
    )
    .run(log.level, log.source, log.message, log.metadata);
}

export function getRecentLogs(limit = 100): AgentLog[] {
  return getDb()
    .prepare("SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as AgentLog[];
}
