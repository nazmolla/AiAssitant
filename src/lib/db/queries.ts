import { getDb, cachedStmt as _cachedStmt } from "./connection";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import { encryptField, decryptField } from "./crypto";
import { normalizeLogLevel, shouldKeepLog, type UnifiedLogLevel, isUnifiedLogLevel } from "@/lib/logging/levels";
import { appCache, CACHE_KEYS } from "@/lib/cache";

/** Thin wrapper that passes the (patchable) `getDb` import to the cache */
function stmt(sql: string) { return _cachedStmt(sql, getDb); }

// â”€â”€â”€ Users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface UserRecord {
  id: string;
  email: string;
  display_name: string;
  provider_id: string;
  external_sub_id: string | null;
  password_hash: string | null;
  role: string;
  created_at: string;
}

export function getUserById(id: string): UserRecord | undefined {
  return appCache.get(
    `${CACHE_KEYS.USER_PREFIX}${id}`,
    () => stmt("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined
  );
}

const AUTH_CACHE_TTL_MS = 300_000; // 5 minutes

export function getUserByEmail(email: string): UserRecord | undefined {
  return appCache.get(
    `${CACHE_KEYS.USER_BY_EMAIL_PREFIX}${email.toLowerCase()}`,
    () => stmt("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email) as UserRecord | undefined,
    AUTH_CACHE_TTL_MS
  );
}

export function getUserByExternalSub(subId: string): UserRecord | undefined {
  return appCache.get(
    `${CACHE_KEYS.USER_BY_SUB_PREFIX}${subId}`,
    () => stmt("SELECT * FROM users WHERE external_sub_id = ?").get(subId) as UserRecord | undefined,
    AUTH_CACHE_TTL_MS
  );
}

export function createUser(args: {
  email: string;
  displayName?: string;
  providerId: string;
  externalSubId: string | null;
  passwordHash?: string | null;
  role?: string;
  enabled?: number;
}): UserRecord {
  const id = uuid();
  const role = args.role || "user";
  // First user (admin) is active immediately; subsequent users start inactive
  // and must be activated by an admin.
  const enabled = args.enabled !== undefined ? args.enabled : (role === "admin" ? 1 : 0);
  getDb()
    .prepare(
      `INSERT INTO users (id, email, display_name, provider_id, external_sub_id, password_hash, role, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      args.email,
      args.displayName || args.email.split("@")[0],
      args.providerId,
      args.externalSubId,
      args.passwordHash ?? null,
      role,
      enabled
    );
  return getUserById(id)!;
}

export function updateUserPassword(userId: string, passwordHash: string): void {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
  invalidateUserCaches(userId);
}

export function listUsers(): UserRecord[] {
  return stmt("SELECT * FROM users ORDER BY created_at ASC").all() as UserRecord[];
}

export function getUserCount(): number {
  return (stmt("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
}

// â”€â”€â”€ User Access Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface UserPermissions {
  user_id: string;
  chat: number;
  knowledge: number;
  dashboard: number;
  approvals: number;
  mcp_servers: number;
  channels: number;
  llm_config: number;
  screen_sharing: number;
}

export interface UserWithPermissions extends UserRecord {
  enabled: number;
  permissions: UserPermissions;
}

export function listUsersWithPermissions(): UserWithPermissions[] {
  const db = getDb();
  // Single JOIN query instead of N+1 (one query per user)
  const rows = db.prepare(
    `SELECT u.*, p.chat, p.knowledge, p.dashboard, p.approvals,
            p.mcp_servers, p.channels, p.llm_config, p.screen_sharing
     FROM users u
     LEFT JOIN user_permissions p ON u.id = p.user_id
     ORDER BY u.created_at ASC`
  ).all() as (UserRecord & { enabled?: number; chat?: number; knowledge?: number; dashboard?: number; approvals?: number; mcp_servers?: number; channels?: number; llm_config?: number; screen_sharing?: number })[];

  return rows.map((u) => {
    const isAdmin = u.role === "admin";
    const hasPerms = u.chat !== null && u.chat !== undefined;
    return {
      ...u,
      enabled: u.enabled ?? 1,
      permissions: hasPerms ? {
        user_id: u.id,
        chat: u.chat!,
        knowledge: u.knowledge!,
        dashboard: u.dashboard!,
        approvals: u.approvals!,
        mcp_servers: u.mcp_servers!,
        channels: u.channels!,
        llm_config: u.llm_config!,
        screen_sharing: u.screen_sharing!,
      } : {
        user_id: u.id,
        chat: 1,
        knowledge: 1,
        dashboard: 1,
        approvals: 1,
        mcp_servers: 1,
        channels: isAdmin ? 1 : 0,
        llm_config: isAdmin ? 1 : 0,
        screen_sharing: 1,
      },
    };
  });
}

export function getUserPermissions(userId: string): UserPermissions | undefined {
  return stmt("SELECT * FROM user_permissions WHERE user_id = ?").get(userId) as UserPermissions | undefined;
}

export function updateUserRole(userId: string, role: string): void {
  if (!["admin", "user"].includes(role)) throw new Error("Invalid role");
  getDb().prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
  invalidateUserCaches(userId);
}

export function updateUserEnabled(userId: string, enabled: boolean): void {
  getDb().prepare("UPDATE users SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, userId);
  invalidateUserCaches(userId);
}

export function updateUserPermissions(userId: string, perms: Partial<Omit<UserPermissions, "user_id">>): void {
  const db = getDb();
  // Ensure row exists
  db.prepare(
    `INSERT OR IGNORE INTO user_permissions (user_id) VALUES (?)`
  ).run(userId);

  const VALID_FIELDS = new Set(["chat", "knowledge", "dashboard", "approvals", "mcp_servers", "channels", "llm_config", "screen_sharing"]);
  for (const [key, value] of Object.entries(perms)) {
    // Strict whitelist check â€” key must be an exact match in VALID_FIELDS (prevents SQL injection via key)
    if (VALID_FIELDS.has(key) && (value === 0 || value === 1)) {
      // key is guaranteed to be one of the hardcoded VALID_FIELDS strings (Set.has passed)
      db.prepare(`UPDATE user_permissions SET ${key} = ? WHERE user_id = ?`).run(value, userId);
    }
  }
}

export function deleteUser(userId: string): void {
  // Capture email/sub before deletion so we can invalidate their cache entries
  const existing = getUserById(userId);
  getDb().prepare("DELETE FROM users WHERE id = ?").run(userId);
  invalidateUserCaches(userId, existing);
  appCache.invalidate(`${CACHE_KEYS.PROFILE_PREFIX}${userId}`);
}

export function isUserEnabled(userId: string): boolean {
  const user = getUserById(userId);
  return ((user as unknown as { enabled?: number })?.enabled ?? 1) === 1;
}

/**
 * Invalidate all cache entries related to a user (by-id, by-email, by-sub).
 * If `known` is provided, uses it to build the email/sub keys; otherwise
 * reads the current record from the by-id cache before clearing it.
 */
function invalidateUserCaches(userId: string, known?: UserRecord): void {
  const user = known ?? getUserById(userId);
  appCache.invalidate(`${CACHE_KEYS.USER_PREFIX}${userId}`);
  if (user?.email) {
    appCache.invalidate(`${CACHE_KEYS.USER_BY_EMAIL_PREFIX}${user.email.toLowerCase()}`);
  }
  if (user?.external_sub_id) {
    appCache.invalidate(`${CACHE_KEYS.USER_BY_SUB_PREFIX}${user.external_sub_id}`);
  }
}

// â”€â”€â”€ Identity (legacy â€” kept for backward compat) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface IdentityConfig {
  id: number;
  owner_email: string;
  provider_id: string;
  external_sub_id: string | null;
  password_hash: string | null;
  api_keys_encrypted: string | null;
}

export function getIdentity(): IdentityConfig | undefined {
  return stmt("SELECT * FROM identity_config WHERE id = 1").get() as IdentityConfig | undefined;
}

// â”€â”€â”€ User Profiles (per-user) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface UserProfile {
  user_id: string;
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
  skills: string;
  languages: string;
  company: string;
  screen_sharing_enabled: number;
  notification_level: string;
  theme: string;
  font: string;
  timezone: string;
  tts_voice: string;
  updated_at: string;
}

export function getUserProfile(userId: string): UserProfile | undefined {
  return appCache.get(
    `${CACHE_KEYS.PROFILE_PREFIX}${userId}`,
    () => stmt("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as UserProfile | undefined
  );
}

export function upsertUserProfile(userId: string, profile: Partial<Omit<UserProfile, "user_id" | "updated_at">>): UserProfile {
  const existing = getUserProfile(userId);
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
    screen_sharing_enabled: profile.screen_sharing_enabled ?? existing?.screen_sharing_enabled ?? 1,
    notification_level: profile.notification_level ?? existing?.notification_level ?? "disaster",
    theme: profile.theme ?? existing?.theme ?? "ember",
    font: profile.font ?? existing?.font ?? "inter",
    timezone: profile.timezone ?? existing?.timezone ?? "",
    tts_voice: profile.tts_voice ?? existing?.tts_voice ?? "nova",
  };
  getDb()
    .prepare(
      `INSERT INTO user_profiles (user_id, display_name, title, bio, location, phone, email, website, linkedin, github, twitter, skills, languages, company, screen_sharing_enabled, notification_level, theme, font, timezone, tts_voice, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
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
         screen_sharing_enabled = excluded.screen_sharing_enabled,
        notification_level = excluded.notification_level,
         theme = excluded.theme,
         font = excluded.font,
         timezone = excluded.timezone,
         tts_voice = excluded.tts_voice,
         updated_at = CURRENT_TIMESTAMP`
    )
    .run(
      userId,
      p.display_name, p.title, p.bio, p.location,
      p.phone, p.email, p.website, p.linkedin,
      p.github, p.twitter, p.skills, p.languages, p.company,
      p.screen_sharing_enabled, p.notification_level, p.theme, p.font, p.timezone, p.tts_voice
    );
  appCache.invalidate(`${CACHE_KEYS.PROFILE_PREFIX}${userId}`);
  return getUserProfile(userId)!;
}

// Legacy owner profile functions (kept for backward compat during migration)
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
  skills: string;
  languages: string;
  company: string;
  updated_at: string;
}

export function getOwnerProfile(): OwnerProfile | undefined {
  return stmt("SELECT * FROM owner_profile WHERE id = 1").get() as OwnerProfile | undefined;
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

// â”€â”€â”€ LLM Providers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type LlmProviderType = "azure-openai" | "openai" | "anthropic" | "litellm";
export type LlmProviderPurpose = "chat" | "embedding" | "tts" | "stt";

export interface LlmProviderRecord {
  id: string;
  label: string;
  provider_type: LlmProviderType;
  purpose: LlmProviderPurpose;
  config_json: string;
  is_default: number;
  created_at: string;
}

/** Decrypt sensitive LLM provider fields after reading from DB */
function decryptLlmProvider(p: LlmProviderRecord | undefined): LlmProviderRecord | undefined {
  if (!p) return undefined;
  return {
    ...p,
    config_json: decryptField(p.config_json) ?? "{}",
  };
}

export function listLlmProviders(): LlmProviderRecord[] {
  return appCache.get(
    CACHE_KEYS.LLM_PROVIDERS,
    () => {
      const rows = getDb()
        .prepare("SELECT * FROM llm_providers ORDER BY created_at DESC")
        .all() as LlmProviderRecord[];
      return rows.map((r) => decryptLlmProvider(r)!);
    }
  );
}

export function getLlmProvider(id: string): LlmProviderRecord | undefined {
  const row = getDb()
    .prepare("SELECT * FROM llm_providers WHERE id = ?")
    .get(id) as LlmProviderRecord | undefined;
  return decryptLlmProvider(row);
}

export function getDefaultLlmProvider(purpose: LlmProviderPurpose = "chat"): LlmProviderRecord | undefined {
  const row = getDb()
    .prepare("SELECT * FROM llm_providers WHERE is_default = 1 AND purpose = ? LIMIT 1")
    .get(purpose) as LlmProviderRecord | undefined;
  return decryptLlmProvider(row);
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
    .run(id, args.label, args.providerType, purpose, encryptField(JSON.stringify(args.config)), args.isDefault ? 1 : 0);

  if (args.isDefault || !getDefaultLlmProvider(purpose)) {
    setDefaultLlmProvider(id);
  }

  appCache.invalidate(CACHE_KEYS.LLM_PROVIDERS);
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
    vals.push(encryptField(JSON.stringify(args.config)));
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

  appCache.invalidate(CACHE_KEYS.LLM_PROVIDERS);
  return getLlmProvider(args.id);
}

export function setDefaultLlmProvider(id: string): void {
  const db = getDb();
  const record = db.prepare("SELECT purpose FROM llm_providers WHERE id = ?").get(id) as { purpose: string } | undefined;
  if (!record) return;
  db.prepare(
    "UPDATE llm_providers SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE purpose = ?"
  ).run(id, record.purpose);
  appCache.invalidate(CACHE_KEYS.LLM_PROVIDERS);
}

export function deleteLlmProvider(id: string): void {
  const db = getDb();
  const record = getLlmProvider(id);
  // PERF-15: Wrap in a single transaction for atomicity
  db.transaction(() => {
    db.prepare("DELETE FROM llm_providers WHERE id = ?").run(id);
    if (record?.is_default) {
      const fallback = db
        .prepare("SELECT id FROM llm_providers WHERE purpose = ? ORDER BY created_at DESC LIMIT 1")
        .get(record.purpose) as { id: string } | undefined;
      if (fallback) {
        setDefaultLlmProvider(fallback.id);
      }
    }
  })();
  appCache.invalidate(CACHE_KEYS.LLM_PROVIDERS);
}

// â”€â”€â”€ MCP Servers (user-scoped + global) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ User Knowledge (per-user) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface KnowledgeEntry {
  id: number;
  user_id: string | null;
  entity: string;
  attribute: string;
  value: string;
  source_context: string | null;
  last_updated: string;
}

export function listKnowledge(userId?: string): KnowledgeEntry[] {
  if (!userId) return [];
  return getDb()
    .prepare("SELECT * FROM user_knowledge WHERE user_id = ? OR user_id IS NULL ORDER BY last_updated DESC")
    .all(userId) as KnowledgeEntry[];
}

export function getKnowledgeEntry(id: number): KnowledgeEntry | undefined {
  return stmt(
    "SELECT * FROM user_knowledge WHERE id = ?"
  ).get(id) as KnowledgeEntry | undefined;
}

export function searchKnowledge(query: string, userId?: string): KnowledgeEntry[] {
  if (!userId) return [];
  const pattern = `%${query}%`;
  // UNION ALL allows SQLite to use the user_id index for both branches
  // instead of a full table scan with OR
  return getDb()
    .prepare(
      `SELECT * FROM user_knowledge
       WHERE user_id = ? AND (entity LIKE ? OR attribute LIKE ? OR value LIKE ?)
       UNION ALL
       SELECT * FROM user_knowledge
       WHERE user_id IS NULL AND (entity LIKE ? OR attribute LIKE ? OR value LIKE ?)
       ORDER BY last_updated DESC`
    )
    .all(userId, pattern, pattern, pattern, pattern, pattern, pattern) as KnowledgeEntry[];
}

export function upsertKnowledge(entry: Omit<KnowledgeEntry, "id" | "last_updated">, userId?: string): number {
  const uid = entry.user_id ?? userId ?? null;
  const row = getDb()
    .prepare(
      `INSERT INTO user_knowledge (user_id, entity, attribute, value, source_context)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, entity, attribute, value) DO UPDATE SET
         value = excluded.value,
         source_context = excluded.source_context,
         last_updated = CURRENT_TIMESTAMP
       RETURNING id`
    )
    .get(uid, entry.entity, entry.attribute, entry.value, entry.source_context) as { id: number } | undefined;

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

// â”€â”€â”€ Knowledge Embeddings (per-user via FK) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

/** List embeddings scoped to a user (via JOIN on user_knowledge) */
export function listKnowledgeEmbeddings(userId?: string): KnowledgeEmbeddingRow[] {
  if (!userId) return [];
  return getDb()
    .prepare(
      `SELECT ke.knowledge_id, ke.embedding
       FROM knowledge_embeddings ke
       JOIN user_knowledge uk ON ke.knowledge_id = uk.id
       WHERE uk.user_id = ? OR uk.user_id IS NULL`
    )
    .all(userId) as KnowledgeEmbeddingRow[];
}

export function getKnowledgeEntriesByIds(ids: number[]): KnowledgeEntry[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return getDb()
    .prepare(`SELECT * FROM user_knowledge WHERE id IN (${placeholders})`)
    .all(...ids) as KnowledgeEntry[];
}

// â”€â”€â”€ Threads (per-user) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface Thread {
  id: string;
  user_id: string | null;
  title: string | null;
  status: string;
  last_message_at: string;
}

export function createThread(title?: string, userId?: string): Thread {
  const id = uuid();
  return getDb()
    .prepare("INSERT INTO threads (id, user_id, title) VALUES (?, ?, ?) RETURNING *")
    .get(id, userId ?? null, title || "New Thread") as Thread;
}

export function listThreads(userId?: string): Thread[] {
  if (userId) {
    return getDb()
      .prepare("SELECT * FROM threads WHERE user_id = ? AND title NOT LIKE '[proactive-scan]%' AND title NOT LIKE '[scheduled]%' AND title NOT LIKE 'channel:%' ORDER BY last_message_at DESC")
      .all(userId) as Thread[];
  }
  return getDb()
    .prepare("SELECT * FROM threads WHERE title NOT LIKE '[proactive-scan]%' AND title NOT LIKE '[scheduled]%' AND title NOT LIKE 'channel:%' ORDER BY last_message_at DESC")
    .all() as Thread[];
}

export function getThread(id: string): Thread | undefined {
  return stmt("SELECT * FROM threads WHERE id = ?").get(id) as Thread | undefined;
}

export function updateThreadStatus(id: string, status: string): void {
  getDb().prepare("UPDATE threads SET status = ? WHERE id = ?").run(status, id);
}

export function updateThreadTitle(id: string, title: string): void {
  getDb().prepare("UPDATE threads SET title = ? WHERE id = ?").run(title, id);
}

export function deleteThread(id: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM attachments WHERE thread_id = ?").run(id);
    db.prepare("DELETE FROM approval_queue WHERE thread_id = ?").run(id);
    db.prepare("DELETE FROM messages WHERE thread_id = ?").run(id);
    db.prepare("DELETE FROM threads WHERE id = ?").run(id);
  })();
}

// â”€â”€â”€ Messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface Message {
  id: number;
  thread_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls: string | null;
  tool_results: string | null;
  attachments: string | null;           // JSON array of AttachmentMeta
  created_at: string | null;            // ISO timestamp
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

export function addMessage(msg: Omit<Message, "id" | "created_at">): Message {
  const db = getDb();
  const row = db
    .prepare(
      `INSERT INTO messages (thread_id, role, content, tool_calls, tool_results, attachments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       RETURNING *`
    )
    .get(msg.thread_id, msg.role, msg.content, msg.tool_calls, msg.tool_results, msg.attachments ?? null) as Message;

  stmt(
    "UPDATE threads SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(msg.thread_id);

  return row;
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
  return stmt("SELECT * FROM attachments WHERE id = ?").get(id) as AttachmentRecord | undefined;
}

export function getMessageAttachments(messageId: number): AttachmentRecord[] {
  return stmt("SELECT * FROM attachments WHERE message_id = ? ORDER BY created_at ASC").all(messageId) as AttachmentRecord[];
}

export function getThreadMessages(threadId: string): Message[] {
  return stmt(
    "SELECT * FROM messages WHERE thread_id = ? ORDER BY id ASC"
  ).all(threadId) as Message[];
}

// â”€â”€â”€ Tool Policies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ToolPolicy {
  tool_name: string;
  mcp_id: string | null;
  requires_approval: number;
  scope: "global" | "user";
}

export function listToolPolicies(): ToolPolicy[] {
  return appCache.get(
    CACHE_KEYS.TOOL_POLICIES,
    () => stmt("SELECT * FROM tool_policies").all() as ToolPolicy[]
  );
}

export function getToolPolicy(toolName: string): ToolPolicy | undefined {
  return stmt("SELECT * FROM tool_policies WHERE tool_name = ?").get(toolName) as ToolPolicy | undefined;
}

export function upsertToolPolicy(policy: ToolPolicy): void {
  getDb()
    .prepare(
      `INSERT INTO tool_policies (tool_name, mcp_id, requires_approval, scope)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tool_name) DO UPDATE SET
         mcp_id = excluded.mcp_id,
         requires_approval = excluded.requires_approval,
         scope = excluded.scope`
    )
    .run(policy.tool_name, policy.mcp_id, policy.requires_approval, policy.scope ?? "global");
  appCache.invalidate(CACHE_KEYS.TOOL_POLICIES);
}

// â”€â”€â”€ Approval Queue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  return getDb()
    .prepare(
      `INSERT INTO approval_queue (id, thread_id, tool_name, args, reasoning)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(id, req.thread_id, req.tool_name, req.args, req.reasoning) as ApprovalRequest;
}

export function getApprovalById(id: string): ApprovalRequest | undefined {
  return stmt("SELECT * FROM approval_queue WHERE id = ?").get(id) as ApprovalRequest | undefined;
}

export function listPendingApprovals(): ApprovalRequest[] {
  return stmt(
    "SELECT * FROM approval_queue WHERE status = 'pending' ORDER BY created_at DESC"
  ).all() as ApprovalRequest[];
}

/**
 * Return pending approvals scoped to threads owned by `userId`.
 * Uses a single JOIN — O(1) queries instead of O(n).
 * Proactive approvals (thread_id IS NULL) are excluded for non-admin callers.
 */
export function listPendingApprovalsForUser(userId: string): ApprovalRequest[] {
  return getDb()
    .prepare(
      `SELECT a.* FROM approval_queue a
       JOIN threads t ON a.thread_id = t.id
       WHERE a.status = 'pending' AND t.user_id = ?
       ORDER BY a.created_at DESC`
    )
    .all(userId) as ApprovalRequest[];
}

/**
 * Auto-reject stale pending approvals in bulk:
 * - thread has been deleted (orphaned)
 * - thread status is no longer 'awaiting_approval'
 * Proactive approvals (thread_id IS NULL) are never touched.
 * Returns the count of rejected rows.
 */
export function cleanStaleApprovals(): number {
  const db = getDb();
  // Reject approvals whose thread no longer exists
  const orphaned = db
    .prepare(
      `UPDATE approval_queue SET status = 'rejected'
       WHERE status = 'pending' AND thread_id IS NOT NULL
         AND thread_id NOT IN (SELECT id FROM threads)`
    )
    .run();
  // Reject approvals whose thread is no longer awaiting_approval
  const stale = db
    .prepare(
      `UPDATE approval_queue SET status = 'rejected'
       WHERE status = 'pending' AND thread_id IS NOT NULL
         AND thread_id IN (SELECT id FROM threads WHERE status != 'awaiting_approval')`
    )
    .run();
  return orphaned.changes + stale.changes;
}

export function updateApprovalStatus(id: string, status: "approved" | "rejected"): void {
  getDb().prepare("UPDATE approval_queue SET status = ? WHERE id = ?").run(status, id);
}

// â”€â”€â”€ Agent Logs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface AgentLog {
  id: number;
  level: UnifiedLogLevel;
  source: string | null;
  message: string;
  metadata: string | null;
  created_at: string;
}

export interface AgentLogInput {
  level: string;
  source: string | null;
  message: string;
  metadata: string | null;
}

export function getAppConfig(key: string): string | undefined {
  const row = stmt("SELECT value FROM app_config WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value;
}

export function setAppConfig(key: string, value: string): void {
  stmt(
    `INSERT INTO app_config (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(key, value);
}

export function getServerMinLogLevel(): UnifiedLogLevel {
  const value = getAppConfig("log_level_min");
  if (isUnifiedLogLevel(value)) return value;
  return "verbose";
}

export function setServerMinLogLevel(level: UnifiedLogLevel): void {
  setAppConfig("log_level_min", level);
}

function getConfiguredMinLogLevel(): UnifiedLogLevel {
  return getServerMinLogLevel();
}

export function addLog(log: AgentLogInput): void {
  const normalizedLevel = normalizeLogLevel(log.level);
  const minLevel = getConfiguredMinLogLevel();
  if (!shouldKeepLog(normalizedLevel, minLevel)) {
    return;
  }

  const rawLevel = String(log.level || "").toLowerCase().trim();
  const normalizedSource =
    rawLevel === "thought" && !log.source
      ? "thought"
      : log.source;

  stmt(
    `INSERT INTO agent_logs (level, source, message, metadata) VALUES (?, ?, ?, ?)`
  ).run(normalizedLevel, normalizedSource, log.message, log.metadata);
}

export function getRecentLogs(limit = 100, level?: UnifiedLogLevel | "all", source?: string | "all"): AgentLog[] {
  const filterByLevel = !!level && level !== "all";
  const filterBySource = !!source && source !== "all";
  // PERF-17: Clamp to sensible bounds to prevent unbounded queries
  const safeLimit = (!Number.isFinite(limit) || limit <= 0) ? 1000 : Math.min(limit, 10000);
  if (filterByLevel && filterBySource) {
    return stmt(
      "SELECT * FROM agent_logs WHERE level = ? AND source = ? ORDER BY created_at DESC LIMIT ?"
    ).all(level, source, safeLimit) as AgentLog[];
  }
  if (filterByLevel) {
    return stmt(
      "SELECT * FROM agent_logs WHERE level = ? ORDER BY created_at DESC LIMIT ?"
    ).all(level, safeLimit) as AgentLog[];
  }
  if (filterBySource) {
    return stmt(
      "SELECT * FROM agent_logs WHERE source = ? ORDER BY created_at DESC LIMIT ?"
    ).all(source, safeLimit) as AgentLog[];
  }
  return stmt("SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ?").all(safeLimit) as AgentLog[];
}

export function deleteAllLogs(): number {
  const result = stmt("DELETE FROM agent_logs").run();
  return Number(result.changes || 0);
}

export function deleteLogsByLevel(level: UnifiedLogLevel): number {
  const result = stmt("DELETE FROM agent_logs WHERE level = ?").run(level);
  return Number(result.changes || 0);
}

export function deleteLogsOlderThanDays(days: number): number {
  const safeDays = Math.max(1, Math.floor(days));
  const result = stmt("DELETE FROM agent_logs WHERE created_at < datetime('now', ?) ").run(`-${safeDays} days`);
  return Number(result.changes || 0);
}

// â”€â”€â”€ Channels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type ChannelType = "whatsapp" | "slack" | "email" | "telegram" | "discord" | "teams";

export interface ChannelRecord {
  id: string;
  channel_type: ChannelType;
  label: string;
  enabled: number;
  config_json: string;
  webhook_secret: string | null;
  user_id: string | null;
  created_at: string;
}

/** Decrypt sensitive channel fields after reading from DB */
function decryptChannel(ch: ChannelRecord | undefined): ChannelRecord | undefined {
  if (!ch) return undefined;
  return {
    ...ch,
    config_json: decryptField(ch.config_json) ?? "{}",
    webhook_secret: decryptField(ch.webhook_secret) as string | null,
  };
}

export function listChannels(userId?: string): ChannelRecord[] {
  const cacheKey = `${CACHE_KEYS.CHANNELS_PREFIX}${userId ?? "_all"}`;
  return appCache.get(cacheKey, () => {
    const rows = userId
      ? getDb().prepare("SELECT * FROM channels WHERE user_id = ? ORDER BY created_at ASC").all(userId) as ChannelRecord[]
      : getDb().prepare("SELECT * FROM channels ORDER BY created_at ASC").all() as ChannelRecord[];
    return rows.map((r) => decryptChannel(r)!);
  });
}

export function getChannel(id: string): ChannelRecord | undefined {
  const row = stmt("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRecord | undefined;
  return decryptChannel(row);
}

export function createChannel(args: {
  label: string;
  channelType: ChannelType;
  configJson: string;
  userId: string;
}): ChannelRecord {
  const id = uuid();
  const webhookSecret = crypto.randomBytes(24).toString("hex");
  getDb()
    .prepare(
      `INSERT INTO channels (id, channel_type, label, enabled, config_json, webhook_secret, user_id)
       VALUES (?, ?, ?, 1, ?, ?, ?)`
    )
    .run(id, args.channelType, args.label, encryptField(args.configJson), encryptField(webhookSecret), args.userId);
  appCache.invalidatePrefix(CACHE_KEYS.CHANNELS_PREFIX);
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
    .run(label, channelType, encryptField(configJson), enabled, args.id);
  appCache.invalidatePrefix(CACHE_KEYS.CHANNELS_PREFIX);
  return getDb().prepare("SELECT * FROM channels WHERE id = ?").get(args.id) as ChannelRecord;
}

export function deleteChannel(id: string): void {
  getDb().prepare("DELETE FROM channels WHERE id = ?").run(id);
  appCache.invalidatePrefix(CACHE_KEYS.CHANNELS_PREFIX);
}

// ─── IMAP UID Tracking ──────────────────────────────────────

export interface ChannelImapState {
  lastImapUid: number;
  lastImapUidvalidity: number;
}

export function getChannelImapState(channelId: string): ChannelImapState {
  const row = stmt(
    "SELECT last_imap_uid, last_imap_uidvalidity FROM channels WHERE id = ?"
  ).get(channelId) as { last_imap_uid: number | null; last_imap_uidvalidity: number | null } | undefined;
  return {
    lastImapUid: row?.last_imap_uid ?? 0,
    lastImapUidvalidity: row?.last_imap_uidvalidity ?? 0,
  };
}

export function updateChannelImapState(
  channelId: string,
  uid: number,
  uidvalidity: number
): void {
  getDb()
    .prepare(
      "UPDATE channels SET last_imap_uid = ?, last_imap_uidvalidity = ? WHERE id = ?"
    )
    .run(uid, uidvalidity, channelId);
}

/**
 * Get the owner user_id for a channel.
 * Used by webhook/Discord handlers â€” the channel owner is assumed to be the user.
 */
export function getChannelOwnerId(channelId: string): string | null {
  const row = stmt("SELECT user_id FROM channels WHERE id = ?").get(channelId) as { user_id: string | null } | undefined;
  return row?.user_id ?? null;
}

// â”€â”€â”€ Channel User Mappings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ChannelUserMapping {
  id: number;
  channel_id: string;
  external_id: string;
  user_id: string;
  created_at: string;
}

export function getChannelUserMapping(channelId: string, externalId: string): ChannelUserMapping | undefined {
  return stmt(
    "SELECT * FROM channel_user_mappings WHERE channel_id = ? AND external_id = ?"
  ).get(channelId, externalId) as ChannelUserMapping | undefined;
}

export function upsertChannelUserMapping(channelId: string, externalId: string, userId: string): void {
  getDb()
    .prepare(
      `INSERT INTO channel_user_mappings (channel_id, external_id, user_id)
       VALUES (?, ?, ?)
       ON CONFLICT(channel_id, external_id) DO UPDATE SET user_id = excluded.user_id`
    )
    .run(channelId, externalId, userId);
}

export function listChannelUserMappings(channelId: string): ChannelUserMapping[] {
  return getDb()
    .prepare("SELECT * FROM channel_user_mappings WHERE channel_id = ?")
    .all(channelId) as ChannelUserMapping[];
}

export function deleteChannelUserMapping(channelId: string, externalId: string): void {
  getDb()
    .prepare("DELETE FROM channel_user_mappings WHERE channel_id = ? AND external_id = ?")
    .run(channelId, externalId);
}

// â”€â”€â”€ Authentication Providers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type AuthProviderType = "azure-ad" | "google" | "discord";

export interface AuthProviderRecord {
  id: string;
  provider_type: AuthProviderType;
  label: string;
  client_id: string | null;
  client_secret: string | null;
  tenant_id: string | null;
  bot_token: string | null;
  application_id: string | null;
  enabled: number;
  created_at: string;
}

/** Decrypt sensitive auth provider fields after reading from DB */
function decryptAuthProvider(p: AuthProviderRecord | undefined): AuthProviderRecord | undefined {
  if (!p) return undefined;
  return {
    ...p,
    client_secret: decryptField(p.client_secret) as string | null,
    bot_token: decryptField(p.bot_token) as string | null,
  };
}

export function listAuthProviders(): AuthProviderRecord[] {
  return appCache.get(CACHE_KEYS.AUTH_PROVIDERS, () => {
    const rows = getDb()
      .prepare("SELECT * FROM auth_providers ORDER BY created_at ASC")
      .all() as AuthProviderRecord[];
    return rows.map((r) => decryptAuthProvider(r)!);
  });
}

export function getEnabledAuthProviders(): AuthProviderRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM auth_providers WHERE enabled = 1 ORDER BY created_at ASC")
    .all() as AuthProviderRecord[];
  return rows.map((r) => decryptAuthProvider(r)!);
}

export function getAuthProvider(id: string): AuthProviderRecord | undefined {
  const row = getDb()
    .prepare("SELECT * FROM auth_providers WHERE id = ?")
    .get(id) as AuthProviderRecord | undefined;
  return decryptAuthProvider(row);
}

export function getAuthProviderByType(providerType: AuthProviderType): AuthProviderRecord | undefined {
  const row = getDb()
    .prepare("SELECT * FROM auth_providers WHERE provider_type = ? LIMIT 1")
    .get(providerType) as AuthProviderRecord | undefined;
  return decryptAuthProvider(row);
}

export function upsertAuthProvider(args: {
  providerType: AuthProviderType;
  label: string;
  clientId?: string | null;
  clientSecret?: string | null;
  tenantId?: string | null;
  botToken?: string | null;
  applicationId?: string | null;
  enabled?: boolean;
}): AuthProviderRecord {
  const id = args.providerType; // use type as id â€” only one per type
  const db = getDb();
  db.prepare(
    `INSERT INTO auth_providers (id, provider_type, label, client_id, client_secret, tenant_id, bot_token, application_id, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       client_id = excluded.client_id,
       client_secret = excluded.client_secret,
       tenant_id = excluded.tenant_id,
       bot_token = excluded.bot_token,
       application_id = excluded.application_id,
       enabled = excluded.enabled`
  ).run(
    id,
    args.providerType,
    args.label,
    args.clientId ?? null,
    encryptField(args.clientSecret ?? null),
    args.tenantId ?? null,
    encryptField(args.botToken ?? null),
    args.applicationId ?? null,
    args.enabled !== false ? 1 : 0
  );
  appCache.invalidate(CACHE_KEYS.AUTH_PROVIDERS);
  return getAuthProvider(id)!;
}

export function deleteAuthProvider(id: string): void {
  getDb().prepare("DELETE FROM auth_providers WHERE id = ?").run(id);
  appCache.invalidate(CACHE_KEYS.AUTH_PROVIDERS);
}

// â”€â”€â”€ Custom Tools (agent-created extensibility) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface CustomToolRecord {
  name: string;
  description: string;
  input_schema: string;
  implementation: string;
  enabled: number;
  created_at: string;
}

export function listCustomTools(): CustomToolRecord[] {
  return getDb()
    .prepare("SELECT * FROM custom_tools ORDER BY created_at DESC")
    .all() as CustomToolRecord[];
}

export function getCustomTool(name: string): CustomToolRecord | undefined {
  return stmt(
    "SELECT * FROM custom_tools WHERE name = ?"
  ).get(name) as CustomToolRecord | undefined;
}

export function createCustomToolRecord(args: {
  name: string;
  description: string;
  inputSchema: string;
  implementation: string;
}): CustomToolRecord {
  getDb()
    .prepare(
      `INSERT INTO custom_tools (name, description, input_schema, implementation, enabled)
       VALUES (?, ?, ?, ?, 1)`
    )
    .run(args.name, args.description, args.inputSchema, args.implementation);
  return getCustomTool(args.name)!;
}

export function updateCustomToolEnabled(name: string, enabled: boolean): void {
  getDb()
    .prepare("UPDATE custom_tools SET enabled = ? WHERE name = ?")
    .run(enabled ? 1 : 0, name);
}

export function updateCustomToolRecord(
  name: string,
  fields: { description: string; inputSchema: string; implementation: string }
): void {
  getDb()
    .prepare(
      "UPDATE custom_tools SET description = ?, input_schema = ?, implementation = ? WHERE name = ?"
    )
    .run(fields.description, fields.inputSchema, fields.implementation, name);
}

export function deleteCustomToolRecord(name: string): void {
  getDb().prepare("DELETE FROM custom_tools WHERE name = ?").run(name);
}

// ─── API Keys ─────────────────────────────────────────────────

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string;       // JSON array
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

/** All valid scopes a key can be granted */
export const API_KEY_SCOPES = ["chat", "knowledge", "approvals", "threads"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * Create an API key.  Returns the DB record AND the raw key (shown once).
 * The raw key format is  nxk_<32-hex-chars>  (128-bit entropy).
 */
export function createApiKey(args: {
  userId: string;
  name: string;
  scopes?: ApiKeyScope[];
  expiresAt?: string | null;
}): { record: ApiKeyRecord; rawKey: string } {
  const id = uuid();
  const rawBytes = crypto.randomBytes(16);
  const rawKey = `nxk_${rawBytes.toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 8);
  const scopes = JSON.stringify(args.scopes ?? ["chat"]);

  getDb()
    .prepare(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, args.userId, args.name, keyHash, keyPrefix, scopes, args.expiresAt ?? null);

  return { record: getApiKeyById(id)!, rawKey };
}

export function getApiKeyById(id: string): ApiKeyRecord | undefined {
  return stmt("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKeyRecord | undefined;
}

/**
 * Look up an API key by its raw key string.
 * Uses the key_prefix for fast DB lookup, then validates the full hash
 * with timing-safe comparison to prevent timing-oracle attacks.
 */
export function getApiKeyByRawKey(rawKey: string): ApiKeyRecord | undefined {
  // Fast-path: reject obvious junk before hitting the DB
  if (!rawKey || rawKey.length < 12) return undefined;

  const prefix = rawKey.slice(0, 8);
  const candidates = stmt("SELECT * FROM api_keys WHERE key_prefix = ?").all(prefix) as ApiKeyRecord[];
  if (candidates.length === 0) return undefined;

  const inputHash = crypto.createHash("sha256").update(rawKey).digest();

  for (const candidate of candidates) {
    const storedHash = Buffer.from(candidate.key_hash, "hex");
    if (storedHash.length === inputHash.length && crypto.timingSafeEqual(inputHash, storedHash)) {
      return candidate;
    }
  }
  return undefined;
}

/** List all API keys for a specific user (safe — never exposes key_hash). */
export function listApiKeys(userId: string): Omit<ApiKeyRecord, "key_hash">[] {
  return stmt(
    "SELECT id, user_id, name, key_prefix, scopes, expires_at, last_used_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as Omit<ApiKeyRecord, "key_hash">[];
}

/** List all API keys across all users (admin). */
export function listAllApiKeys(): (Omit<ApiKeyRecord, "key_hash"> & { email: string })[] {
  return stmt(
    `SELECT k.id, k.user_id, k.name, k.key_prefix, k.scopes, k.expires_at, k.last_used_at, k.created_at, u.email
     FROM api_keys k JOIN users u ON k.user_id = u.id ORDER BY k.created_at DESC`
  ).all() as (Omit<ApiKeyRecord, "key_hash"> & { email: string })[];
}

/** Update the last_used_at timestamp for a key. */
export function touchApiKey(id: string): void {
  getDb().prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

/** Delete a single API key. */
export function deleteApiKey(id: string): void {
  getDb().prepare("DELETE FROM api_keys WHERE id = ?").run(id);
}

/** Delete all API keys belonging to a user. */
export function deleteApiKeysByUser(userId: string): void {
  getDb().prepare("DELETE FROM api_keys WHERE user_id = ?").run(userId);
}

/** Revoke all expired keys (housekeeping). */
export function revokeExpiredApiKeys(): number {
  const result = getDb()
    .prepare("DELETE FROM api_keys WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP")
    .run();
  return result.changes;
}

// ─── Notifications ──────────────────────────────────────────────

export type NotificationType =
  | "approval_required"
  | "tool_error"
  | "proactive_action"
  | "channel_error"
  | "system_error"
  | "info";

export interface NotificationRecord {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  metadata: string | null;
  read: number;
  created_at: string;
}

export function createNotification(n: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  metadata?: string | null;
}): NotificationRecord {
  const id = uuid();
  return getDb()
    .prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, metadata)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(id, n.userId, n.type, n.title, n.body ?? null, n.metadata ?? null) as NotificationRecord;
}

export function listNotifications(userId: string, limit = 50): NotificationRecord[] {
  return stmt(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(userId, limit) as NotificationRecord[];
}

export function countUnreadNotifications(userId: string): number {
  const row = stmt(
    "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0"
  ).get(userId) as { count: number };
  return row.count;
}

export function markNotificationRead(id: string, userId: string): void {
  getDb().prepare(
    "UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?"
  ).run(id, userId);
}

export function markAllNotificationsRead(userId: string): void {
  getDb().prepare(
    "UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0"
  ).run(userId);
}

export function deleteNotification(id: string, userId: string): void {
  getDb().prepare(
    "DELETE FROM notifications WHERE id = ? AND user_id = ?"
  ).run(id, userId);
}

export function deleteOldNotifications(daysOld = 30): number {
  const result = getDb()
    .prepare("DELETE FROM notifications WHERE created_at < datetime('now', ?)")
    .run(`-${daysOld} days`);
  return result.changes;
}

export type ScheduledTaskFrequency = "once" | "hourly" | "daily" | "weekly" | "monthly";
export type ScheduledTaskScope = "user" | "global";
export type ScheduledTaskSource = "user_request" | "proactive";
export type ScheduledTaskStatus = "active" | "paused" | "completed" | "failed";

export interface ScheduledTaskRecord {
  id: string;
  user_id: string | null;
  thread_id: string | null;
  task_name: string;
  frequency: ScheduledTaskFrequency;
  interval_value: number;
  next_run_at: string;
  last_run_at: string | null;
  run_count: number;
  scope: ScheduledTaskScope;
  source: ScheduledTaskSource;
  task_payload: string;
  status: ScheduledTaskStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function createScheduledTask(task: {
  userId?: string | null;
  threadId?: string | null;
  taskName: string;
  frequency?: ScheduledTaskFrequency;
  intervalValue?: number;
  nextRunAt: string;
  scope?: ScheduledTaskScope;
  source?: ScheduledTaskSource;
  taskPayload: string;
  status?: ScheduledTaskStatus;
}): ScheduledTaskRecord {
  const id = uuid();
  return getDb().prepare(
    `INSERT INTO scheduled_tasks (
      id, user_id, thread_id, task_name, frequency, interval_value,
      next_run_at, scope, source, task_payload, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`
  ).get(
    id,
    task.userId ?? null,
    task.threadId ?? null,
    task.taskName,
    task.frequency ?? "once",
    Math.max(1, task.intervalValue ?? 1),
    task.nextRunAt,
    task.scope ?? "user",
    task.source ?? "user_request",
    task.taskPayload,
    task.status ?? "active"
  ) as ScheduledTaskRecord;
}

export function listDueScheduledTasks(limit = 50): ScheduledTaskRecord[] {
  return stmt(
    `SELECT *
     FROM scheduled_tasks
     WHERE status = 'active'
       AND datetime(next_run_at) <= datetime('now')
     ORDER BY next_run_at ASC
     LIMIT ?`
  ).all(limit) as ScheduledTaskRecord[];
}

export function updateScheduledTaskAfterRun(taskId: string, args: {
  status: ScheduledTaskStatus;
  nextRunAt?: string | null;
  threadId?: string | null;
  lastError?: string | null;
}): void {
  getDb().prepare(
    `UPDATE scheduled_tasks
     SET status = ?,
         next_run_at = COALESCE(?, next_run_at),
         thread_id = COALESCE(?, thread_id),
         last_run_at = CURRENT_TIMESTAMP,
         run_count = run_count + 1,
         last_error = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(args.status, args.nextRunAt ?? null, args.threadId ?? null, args.lastError ?? null, taskId);
}

export function markScheduledTaskFailed(taskId: string, error: string): void {
  getDb().prepare(
    `UPDATE scheduled_tasks
     SET status = 'failed',
         last_error = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(error, taskId);
}
