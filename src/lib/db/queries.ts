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

// ─── Owner Profile ───────────────────────────────────────────

export interface OwnerProfile {
  id: number;
  display_name: string;
  title: string;
  bio: string;
  location: string;
  phone: string;
  email: string;
  website: string;
  linkedin: string;
  github: string;
  twitter: string;
  skills: string;     // JSON array
  languages: string;  // JSON array
  company: string;
  updated_at: string;
}

export function getOwnerProfile(): OwnerProfile | undefined {
  return getDb().prepare("SELECT * FROM owner_profile WHERE id = 1").get() as OwnerProfile | undefined;
}

export function upsertOwnerProfile(profile: Partial<Omit<OwnerProfile, "id" | "updated_at">>): OwnerProfile {
  const existing = getOwnerProfile();
  const p = {
    display_name: profile.display_name ?? existing?.display_name ?? "",
    title: profile.title ?? existing?.title ?? "",
    bio: profile.bio ?? existing?.bio ?? "",
    location: profile.location ?? existing?.location ?? "",
    phone: profile.phone ?? existing?.phone ?? "",
    email: profile.email ?? existing?.email ?? "",
    website: profile.website ?? existing?.website ?? "",
    linkedin: profile.linkedin ?? existing?.linkedin ?? "",
    github: profile.github ?? existing?.github ?? "",
    twitter: profile.twitter ?? existing?.twitter ?? "",
    skills: profile.skills ?? existing?.skills ?? "[]",
    languages: profile.languages ?? existing?.languages ?? "[]",
    company: profile.company ?? existing?.company ?? "",
  };
  getDb()
    .prepare(
      `INSERT INTO owner_profile (id, display_name, title, bio, location, phone, email, website, linkedin, github, twitter, skills, languages, company, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         title = excluded.title,
         bio = excluded.bio,
         location = excluded.location,
         phone = excluded.phone,
         email = excluded.email,
         website = excluded.website,
         linkedin = excluded.linkedin,
         github = excluded.github,
         twitter = excluded.twitter,
         skills = excluded.skills,
         languages = excluded.languages,
         company = excluded.company,
         updated_at = CURRENT_TIMESTAMP`
    )
    .run(
      p.display_name, p.title, p.bio, p.location,
      p.phone, p.email, p.website, p.linkedin,
      p.github, p.twitter, p.skills, p.languages, p.company
    );
  return getDb().prepare("SELECT * FROM owner_profile WHERE id = 1").get() as OwnerProfile;
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

// ─── LLM Providers ──────────────────────────────────────────

export type LlmProviderType = "azure-openai" | "openai" | "anthropic";
export type LlmProviderPurpose = "chat" | "embedding";

export interface LlmProviderRecord {
  id: string;
  label: string;
  provider_type: LlmProviderType;
  purpose: LlmProviderPurpose;
  config_json: string;
  is_default: number;
  created_at: string;
}

export function listLlmProviders(): LlmProviderRecord[] {
  return getDb()
    .prepare("SELECT * FROM llm_providers ORDER BY created_at DESC")
    .all() as LlmProviderRecord[];
}

export function getLlmProvider(id: string): LlmProviderRecord | undefined {
  return getDb()
    .prepare("SELECT * FROM llm_providers WHERE id = ?")
    .get(id) as LlmProviderRecord | undefined;
}

export function getDefaultLlmProvider(purpose: LlmProviderPurpose = "chat"): LlmProviderRecord | undefined {
  return getDb()
    .prepare("SELECT * FROM llm_providers WHERE is_default = 1 AND purpose = ? LIMIT 1")
    .get(purpose) as LlmProviderRecord | undefined;
}

export function createLlmProvider(args: {
  label: string;
  providerType: LlmProviderType;
  purpose?: LlmProviderPurpose;
  config: Record<string, unknown>;
  isDefault?: boolean;
}): LlmProviderRecord {
  const id = uuid();
  const purpose = args.purpose || "chat";
  const db = getDb();
  db
    .prepare(
      `INSERT INTO llm_providers (id, label, provider_type, purpose, config_json, is_default)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, args.label, args.providerType, purpose, JSON.stringify(args.config), args.isDefault ? 1 : 0);

  if (args.isDefault || !getDefaultLlmProvider(purpose)) {
    setDefaultLlmProvider(id);
  }

  return getLlmProvider(id)!;
}

export function updateLlmProvider(args: {
  id: string;
  label?: string;
  providerType?: LlmProviderType;
  purpose?: LlmProviderPurpose;
  config?: Record<string, unknown>;
  isDefault?: boolean;
}): LlmProviderRecord | undefined {
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (args.label !== undefined) {
    sets.push("label = ?");
    vals.push(args.label);
  }
  if (args.providerType !== undefined) {
    sets.push("provider_type = ?");
    vals.push(args.providerType);
  }
  if (args.purpose !== undefined) {
    sets.push("purpose = ?");
    vals.push(args.purpose);
  }
  if (args.config !== undefined) {
    sets.push("config_json = ?");
    vals.push(JSON.stringify(args.config));
  }

  if (sets.length > 0) {
    vals.push(args.id);
    getDb()
      .prepare(`UPDATE llm_providers SET ${sets.join(", ")} WHERE id = ?`)
      .run(...vals);
  }

  if (args.isDefault) {
    setDefaultLlmProvider(args.id);
  }

  return getLlmProvider(args.id);
}

export function setDefaultLlmProvider(id: string): void {
  const db = getDb();
  const record = db.prepare("SELECT purpose FROM llm_providers WHERE id = ?").get(id) as { purpose: string } | undefined;
  if (!record) return;
  db.prepare(
    "UPDATE llm_providers SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE purpose = ?"
  ).run(id, record.purpose);
}

export function deleteLlmProvider(id: string): void {
  const record = getLlmProvider(id);
  getDb().prepare("DELETE FROM llm_providers WHERE id = ?").run(id);

  if (record?.is_default) {
    const fallback = getDb()
      .prepare("SELECT id FROM llm_providers WHERE purpose = ? ORDER BY created_at DESC LIMIT 1")
      .get(record.purpose) as { id: string } | undefined;
    if (fallback) {
      setDefaultLlmProvider(fallback.id);
    }
  }
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

export function upsertKnowledge(entry: Omit<KnowledgeEntry, "id" | "last_updated">): number {
  const row = getDb()
    .prepare(
      `INSERT INTO user_knowledge (entity, attribute, value, source_context)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(entity, attribute, value) DO UPDATE SET
         value = excluded.value,
         source_context = excluded.source_context,
         last_updated = CURRENT_TIMESTAMP
       RETURNING id`
    )
    .get(entry.entity, entry.attribute, entry.value, entry.source_context) as { id: number } | undefined;

  if (!row) {
    throw new Error("Failed to upsert knowledge entry");
  }

  return row.id;
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

// ─── Knowledge Embeddings ───────────────────────────────────

interface KnowledgeEmbeddingRow {
  knowledge_id: number;
  embedding: string;
}

export function upsertKnowledgeEmbedding(knowledgeId: number, embedding: number[]): void {
  getDb()
    .prepare(
      `INSERT INTO knowledge_embeddings (knowledge_id, embedding)
       VALUES (?, ?)
       ON CONFLICT(knowledge_id) DO UPDATE SET embedding = excluded.embedding`
    )
    .run(knowledgeId, JSON.stringify(embedding));
}

export function listKnowledgeEmbeddings(): KnowledgeEmbeddingRow[] {
  return getDb()
    .prepare("SELECT knowledge_id, embedding FROM knowledge_embeddings")
    .all() as KnowledgeEmbeddingRow[];
}

export function getKnowledgeEntriesByIds(ids: number[]): KnowledgeEntry[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return getDb()
    .prepare(`SELECT * FROM user_knowledge WHERE id IN (${placeholders})`)
    .all(...ids) as KnowledgeEntry[];
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

export function deleteThread(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM attachments WHERE thread_id = ?").run(id);
  db.prepare("DELETE FROM approval_queue WHERE thread_id = ?").run(id);
  db.prepare("DELETE FROM messages WHERE thread_id = ?").run(id);
  db.prepare("DELETE FROM threads WHERE id = ?").run(id);
}

// ─── Messages ────────────────────────────────────────────────

export interface Message {
  id: number;
  thread_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls: string | null;
  tool_results: string | null;
  attachments: string | null;           // JSON array of AttachmentMeta
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

export function addMessage(msg: Omit<Message, "id">): Message {
  const result = getDb()
    .prepare(
      `INSERT INTO messages (thread_id, role, content, tool_calls, tool_results, attachments)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(msg.thread_id, msg.role, msg.content, msg.tool_calls, msg.tool_results, msg.attachments ?? null);

  getDb()
    .prepare("UPDATE threads SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(msg.thread_id);

  return getDb().prepare("SELECT * FROM messages WHERE id = ?").get(result.lastInsertRowid) as Message;
}

export interface AttachmentRecord {
  id: string;
  thread_id: string;
  message_id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

export function addAttachment(att: Omit<AttachmentRecord, "created_at">): void {
  getDb()
    .prepare(
      `INSERT INTO attachments (id, thread_id, message_id, filename, mime_type, size_bytes, storage_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(att.id, att.thread_id, att.message_id, att.filename, att.mime_type, att.size_bytes, att.storage_path);
}

export function getAttachment(id: string): AttachmentRecord | undefined {
  return getDb().prepare("SELECT * FROM attachments WHERE id = ?").get(id) as AttachmentRecord | undefined;
}

export function getMessageAttachments(messageId: number): AttachmentRecord[] {
  return getDb().prepare("SELECT * FROM attachments WHERE message_id = ? ORDER BY created_at ASC").all(messageId) as AttachmentRecord[];
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

// ─── Channels ────────────────────────────────────────────────

export type ChannelType = "whatsapp" | "slack" | "email" | "telegram" | "discord" | "teams";

export interface ChannelRecord {
  id: string;
  channel_type: ChannelType;
  label: string;
  enabled: number;
  config_json: string;
  webhook_secret: string | null;
  created_at: string;
}

export function listChannels(): ChannelRecord[] {
  return getDb().prepare("SELECT * FROM channels ORDER BY created_at ASC").all() as ChannelRecord[];
}

export function getChannel(id: string): ChannelRecord | undefined {
  return getDb().prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRecord | undefined;
}

export function createChannel(args: {
  label: string;
  channelType: ChannelType;
  configJson: string;
}): ChannelRecord {
  const id = uuid();
  const crypto = require("crypto");
  const webhookSecret = crypto.randomBytes(24).toString("hex");
  getDb()
    .prepare(
      `INSERT INTO channels (id, channel_type, label, enabled, config_json, webhook_secret)
       VALUES (?, ?, ?, 1, ?, ?)`
    )
    .run(id, args.channelType, args.label, args.configJson, webhookSecret);
  return getDb().prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRecord;
}

export function updateChannel(args: {
  id: string;
  label?: string;
  channelType?: ChannelType;
  configJson?: string;
  enabled?: boolean;
}): ChannelRecord | undefined {
  const existing = getChannel(args.id);
  if (!existing) return undefined;
  const label = args.label ?? existing.label;
  const channelType = args.channelType ?? existing.channel_type;
  const configJson = args.configJson ?? existing.config_json;
  const enabled = args.enabled !== undefined ? (args.enabled ? 1 : 0) : existing.enabled;
  getDb()
    .prepare(
      `UPDATE channels SET label = ?, channel_type = ?, config_json = ?, enabled = ? WHERE id = ?`
    )
    .run(label, channelType, configJson, enabled, args.id);
  return getDb().prepare("SELECT * FROM channels WHERE id = ?").get(args.id) as ChannelRecord;
}

export function deleteChannel(id: string): void {
  getDb().prepare("DELETE FROM channels WHERE id = ?").run(id);
}
