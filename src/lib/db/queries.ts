import { getDb, cachedStmt as _cachedStmt } from "./connection";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { encryptField, decryptField } from "./crypto";
import { normalizeLogLevel, shouldKeepLog, type UnifiedLogLevel, isUnifiedLogLevel } from "@/lib/logging/levels";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { buildApprovalPreferenceSignature } from "@/lib/approvals/preference-signature";

/** Thin wrapper that passes the (patchable) `getDb` import to the cache */
function stmt(sql: string) { return _cachedStmt(sql, getDb); }

/** Generic paginated result wrapper */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

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
    () => stmt(`
      SELECT u.* FROM users u
      WHERE LOWER(u.email) = LOWER(?)
      UNION
      SELECT u.* FROM users u
      INNER JOIN user_emails ue ON u.id = ue.user_id
      WHERE LOWER(ue.email) = LOWER(?)
      LIMIT 1
    `).get(email, email) as UserRecord | undefined,
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

export function getUserEmailsByUserId(userId: string): string[] {
  const rows = stmt("SELECT email FROM user_emails WHERE user_id = ? ORDER BY added_at ASC").all(userId) as Array<{ email: string }>;
  return rows.map(row => row.email);
}

export function addUserEmail(userId: string, email: string): void {
  stmt("INSERT INTO user_emails (id, user_id, email) VALUES (?, ?, ?)").run(uuid(), userId, email.toLowerCase());
  // Invalidate user cache and email-based lookup cache
  invalidateUserCaches(userId);
  appCache.invalidate(`${CACHE_KEYS.USER_BY_EMAIL_PREFIX}${email.toLowerCase()}`);
}

export function removeUserEmail(userId: string, email: string): void {
  stmt("DELETE FROM user_emails WHERE user_id = ? AND email = ?").run(userId, email.toLowerCase());
  // Invalidate user cache and email-based lookup cache
  invalidateUserCaches(userId);
  appCache.invalidate(`${CACHE_KEYS.USER_BY_EMAIL_PREFIX}${email.toLowerCase()}`);
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
  // Also invalidate secondary emails cache entries
  try {
    const secondaryEmails = stmt("SELECT email FROM user_emails WHERE user_id = ?").all(userId) as Array<{ email: string }>;
    for (const record of secondaryEmails) {
      appCache.invalidate(`${CACHE_KEYS.USER_BY_EMAIL_PREFIX}${record.email.toLowerCase()}`);
    }
  } catch {
    // user_emails table may not exist during initialization
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
  avatar_url: string;
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
    avatar_url: profile.avatar_url ?? existing?.avatar_url ?? "",
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
      `INSERT INTO user_profiles (user_id, display_name, avatar_url, title, bio, location, phone, email, website, linkedin, github, twitter, skills, languages, company, screen_sharing_enabled, notification_level, theme, font, timezone, tts_voice, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
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
      p.display_name, p.avatar_url, p.title, p.bio, p.location,
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
  source_type: "manual" | "chat" | "proactive";
  source_context: string | null;
  last_updated: string;
}

export function listKnowledge(userId?: string): KnowledgeEntry[] {
  if (!userId) return [];
  return getDb()
    .prepare("SELECT * FROM user_knowledge WHERE user_id = ? OR user_id IS NULL ORDER BY last_updated DESC")
    .all(userId) as KnowledgeEntry[];
}

export function listKnowledgePaginated(userId: string, limit = 100, offset = 0): PaginatedResult<KnowledgeEntry> {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as cnt FROM user_knowledge WHERE user_id = ? OR user_id IS NULL")
    .get(userId) as { cnt: number }).cnt;
  const data = db.prepare(
    "SELECT * FROM user_knowledge WHERE user_id = ? OR user_id IS NULL ORDER BY last_updated DESC LIMIT ? OFFSET ?"
  ).all(userId, limit, offset) as KnowledgeEntry[];
  return { data, total, limit, offset, hasMore: offset + data.length < total };
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
  // instead of a full table scan with OR.
  // LIMIT 100 caps the result set to prevent runaway scans on large tables.
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT * FROM user_knowledge
         WHERE user_id = ? AND (entity LIKE ? OR attribute LIKE ? OR value LIKE ?)
         UNION ALL
         SELECT * FROM user_knowledge
         WHERE user_id IS NULL AND (entity LIKE ? OR attribute LIKE ? OR value LIKE ?)
       )
       ORDER BY last_updated DESC
       LIMIT 100`
    )
    .all(userId, pattern, pattern, pattern, pattern, pattern, pattern) as KnowledgeEntry[];
}

export function upsertKnowledge(
  entry: Omit<KnowledgeEntry, "id" | "last_updated" | "source_type"> & { source_type?: KnowledgeEntry["source_type"] },
  userId?: string
): number {
  const normalizeFactText = (input: string) => input.replace(/\s+/g, " ").trim();
  const uid = entry.user_id ?? userId ?? null;
  const sourceType = entry.source_type ?? "manual";

  const entity = normalizeFactText(entry.entity);
  const attribute = normalizeFactText(entry.attribute);
  const value = normalizeFactText(entry.value);
  const sourceContext = typeof entry.source_context === "string"
    ? entry.source_context.slice(0, 220)
    : entry.source_context;

  // Merge near-duplicates that differ only by case/whitespace into one canonical row.
  const existing = getDb()
    .prepare(
      `SELECT id
       FROM user_knowledge
       WHERE ((? IS NULL AND user_id IS NULL) OR user_id = ?)
         AND lower(trim(entity)) = lower(trim(?))
         AND lower(trim(attribute)) = lower(trim(?))
         AND lower(trim(value)) = lower(trim(?))
       ORDER BY last_updated DESC, id DESC
       LIMIT 1`
    )
    .get(uid, uid, entity, attribute, value) as { id: number } | undefined;

  if (existing) {
    getDb()
      .prepare(
        `UPDATE user_knowledge
         SET entity = ?,
             attribute = ?,
             value = ?,
             source_type = ?,
             source_context = ?,
             last_updated = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(entity, attribute, value, sourceType, sourceContext, existing.id);
    return existing.id;
  }

  const row = getDb()
    .prepare(
      `INSERT INTO user_knowledge (user_id, entity, attribute, value, source_type, source_context)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, entity, attribute, value) DO UPDATE SET
         value = excluded.value,
         source_type = excluded.source_type,
         source_context = excluded.source_context,
         last_updated = CURRENT_TIMESTAMP
       RETURNING id`
    )
    .get(uid, entity, attribute, value, sourceType, sourceContext) as { id: number } | undefined;

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
  thread_type: "interactive" | "proactive" | "scheduled" | "channel";
  is_interactive: number;
  channel_id: string | null;
  external_sender_id: string | null;
  status: string;
  last_message_at: string;
}

export interface CreateThreadOptions {
  threadType?: "interactive" | "proactive" | "scheduled" | "channel";
  channelId?: string;
  externalSenderId?: string;
  status?: string;
}

export function createThread(title?: string, userId?: string, options?: CreateThreadOptions): Thread {
  const id = uuid();
  const threadType = options?.threadType ?? "interactive";
  const isInteractive = threadType === "interactive" ? 1 : 0;
  const status = options?.status ?? "active";
  return getDb()
    .prepare(
      `INSERT INTO threads (id, user_id, title, thread_type, is_interactive, channel_id, external_sender_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      id,
      userId ?? null,
      title || "New Thread",
      threadType,
      isInteractive,
      options?.channelId ?? null,
      options?.externalSenderId ?? null,
      status
    ) as Thread;
}

export function listThreads(userId?: string): Thread[] {
  if (userId) {
    return getDb()
      .prepare("SELECT * FROM threads WHERE user_id = ? AND thread_type = 'interactive' AND is_interactive = 1 ORDER BY last_message_at DESC")
      .all(userId) as Thread[];
  }
  return getDb()
    .prepare("SELECT * FROM threads WHERE thread_type = 'interactive' AND is_interactive = 1 ORDER BY last_message_at DESC")
    .all() as Thread[];
}

const THREAD_FILTER = "thread_type = 'interactive' AND is_interactive = 1";

export function listThreadsPaginated(userId: string, limit = 50, offset = 0): PaginatedResult<Thread> {
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM threads WHERE user_id = ? AND ${THREAD_FILTER}`)
    .get(userId) as { cnt: number }).cnt;
  const data = db.prepare(
    `SELECT * FROM threads WHERE user_id = ? AND ${THREAD_FILTER} ORDER BY last_message_at DESC LIMIT ? OFFSET ?`
  ).all(userId, limit, offset) as Thread[];
  return { data, total, limit, offset, hasMore: offset + data.length < total };
}

export function getThread(id: string): Thread | undefined {
  return stmt("SELECT * FROM threads WHERE id = ?").get(id) as Thread | undefined;
}

export function findActiveChannelThread(channelId: string, senderId: string, userId?: string | null): Thread | undefined {
  if (userId) {
    return getDb()
      .prepare(
        `SELECT * FROM threads
         WHERE thread_type = 'channel'
           AND channel_id = ?
           AND external_sender_id = ?
           AND user_id = ?
           AND status = 'active'
         ORDER BY last_message_at DESC
         LIMIT 1`
      )
      .get(channelId, senderId, userId) as Thread | undefined;
  }

  return getDb()
    .prepare(
      `SELECT * FROM threads
       WHERE thread_type = 'channel'
         AND channel_id = ?
         AND external_sender_id = ?
         AND status = 'active'
       ORDER BY last_message_at DESC
       LIMIT 1`
    )
    .get(channelId, senderId) as Thread | undefined;
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
  nl_request: string | null;
  source: string;
  status: string;
  created_at: string;
}

export function createApprovalRequest(req: Omit<ApprovalRequest, "id" | "status" | "created_at" | "nl_request" | "source"> & { nl_request?: string | null; source?: string }): ApprovalRequest {
  const id = uuid();
  return getDb()
    .prepare(
      `INSERT INTO approval_queue (id, thread_id, tool_name, args, reasoning, nl_request, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(id, req.thread_id, req.tool_name, req.args, req.reasoning, req.nl_request ?? null, req.source ?? "chat") as ApprovalRequest;
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

export interface ApprovalPreference {
  id: string;
  user_id: string;
  tool_name: string;
  request_key: string;
  device_key: string;
  reason_key: string;
  decision: "approved" | "rejected" | "ignored";
  created_at: string;
  updated_at: string;
}

export function upsertApprovalPreferenceFromApproval(
  userId: string,
  approval: ApprovalRequest,
  decision: "approved" | "rejected" | "ignored"
): void {
  const signature = buildApprovalPreferenceSignature({
    toolName: approval.tool_name,
    argsRaw: approval.args,
    reasoning: approval.reasoning,
    nlRequest: approval.nl_request,
  });

  getDb().prepare(
    `INSERT INTO approval_preferences (id, user_id, tool_name, request_key, device_key, reason_key, decision)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, tool_name, request_key, device_key, reason_key)
     DO UPDATE SET
       decision = excluded.decision,
       updated_at = CURRENT_TIMESTAMP`
  ).run(
    uuid(),
    userId,
    approval.tool_name,
    signature.request_key,
    signature.device_key,
    signature.reason_key,
    decision
  );
}

export function findApprovalPreferenceDecision(
  userId: string,
  toolName: string,
  argsRaw: string,
  reasoning: string | null,
  nlRequest?: string | null
): "approved" | "rejected" | "ignored" | null {
  const signature = buildApprovalPreferenceSignature({
    toolName,
    argsRaw,
    reasoning,
    nlRequest,
  });

  const row = getDb().prepare(
    `SELECT decision FROM approval_preferences
     WHERE user_id = ?
       AND tool_name = ?
       AND request_key = ?
       AND device_key = ?
       AND reason_key = ?`
  ).get(
    userId,
    toolName,
    signature.request_key,
    signature.device_key,
    signature.reason_key
  ) as { decision: "approved" | "rejected" | "ignored" } | undefined;

  return row?.decision ?? null;
}

export function listApprovalPreferences(userId: string): ApprovalPreference[] {
  return getDb()
    .prepare(
      `SELECT * FROM approval_preferences
       WHERE user_id = ?
       ORDER BY updated_at DESC`
    )
    .all(userId) as ApprovalPreference[];
}

export function updateApprovalPreferenceDecision(
  id: string,
  userId: string,
  decision: "approved" | "rejected" | "ignored"
): boolean {
  const result = getDb()
    .prepare(
      `UPDATE approval_preferences
       SET decision = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    )
    .run(decision, id, userId);
  return result.changes > 0;
}

export function deleteApprovalPreference(id: string, userId: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM approval_preferences WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return result.changes > 0;
}

export function deleteAllApprovalPreferences(userId: string): number {
  const result = getDb()
    .prepare("DELETE FROM approval_preferences WHERE user_id = ?")
    .run(userId);
  return result.changes;
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

export function getRecentLogs(limit = 100, level?: UnifiedLogLevel | "all", source?: string | "all", metadataContains?: string[]): AgentLog[] {
  const filterByLevel = !!level && level !== "all";
  const filterBySource = !!source && source !== "all";
  const metadataTokens = (metadataContains || []).filter((token) => typeof token === "string" && token.trim().length > 0);
  const filterByMetadata = metadataTokens.length > 0;
  // PERF-17: Clamp to sensible bounds to prevent unbounded queries
  const safeLimit = (!Number.isFinite(limit) || limit <= 0) ? 1000 : Math.min(limit, 10000);
  if (filterByMetadata) {
    const clauses: string[] = [];
    const args: Array<string | number> = [];

    if (filterByLevel) {
      clauses.push("level = ?");
      args.push(level!);
    }
    if (filterBySource) {
      clauses.push("source = ?");
      args.push(source!);
    }
    for (const token of metadataTokens) {
      clauses.push("metadata LIKE ?");
      args.push(`%${token}%`);
    }

    args.push(safeLimit);
    return stmt(
      `SELECT * FROM agent_logs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`
    ).all(...args) as AgentLog[];
  }

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

export function getLogsAfterId(
  afterId: number,
  limit = 200,
  level?: UnifiedLogLevel | "all",
  source?: string | "all"
): AgentLog[] {
  const filterByLevel = !!level && level !== "all";
  const filterBySource = !!source && source !== "all";
  const safeAfterId = Number.isFinite(afterId) ? Math.max(0, Math.floor(afterId)) : 0;
  const safeLimit = (!Number.isFinite(limit) || limit <= 0) ? 200 : Math.min(limit, 1000);

  if (filterByLevel && filterBySource) {
    return stmt(
      "SELECT * FROM agent_logs WHERE id > ? AND level = ? AND source = ? ORDER BY id ASC LIMIT ?"
    ).all(safeAfterId, level, source, safeLimit) as AgentLog[];
  }
  if (filterByLevel) {
    return stmt(
      "SELECT * FROM agent_logs WHERE id > ? AND level = ? ORDER BY id ASC LIMIT ?"
    ).all(safeAfterId, level, safeLimit) as AgentLog[];
  }
  if (filterBySource) {
    return stmt(
      "SELECT * FROM agent_logs WHERE id > ? AND source = ? ORDER BY id ASC LIMIT ?"
    ).all(safeAfterId, source, safeLimit) as AgentLog[];
  }
  return stmt("SELECT * FROM agent_logs WHERE id > ? ORDER BY id ASC LIMIT ?").all(safeAfterId, safeLimit) as AgentLog[];
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

const ATTACHMENTS_ROOT = path.join(process.cwd(), "data", "attachments");

function getDbFilePath(): string {
  return process.env.DATABASE_PATH || path.join(process.cwd(), "nexus.db");
}

export interface DbMaintenanceConfig {
  enabled: boolean;
  intervalHours: number;
  logsRetentionDays: number;
  threadsRetentionDays: number;
  attachmentsRetentionDays: number;
  cleanupLogs: boolean;
  cleanupThreads: boolean;
  cleanupAttachments: boolean;
  cleanupOrphanFiles: boolean;
  lastRunAt: string | null;
}

export interface DbTableBreakdown {
  table: string;
  rowCount: number;
  estimatedBytes: number | null;
}

export interface DbStorageStats {
  dbPath: string;
  dbBytes: number;
  walBytes: number;
  shmBytes: number;
  attachmentsBytes: number;
  totalManagedBytes: number;
  pageCount: number;
  pageSize: number;
  tables: DbTableBreakdown[];
}

export interface HostResourceUsage {
  platform: NodeJS.Platform;
  uptimeSec: number;
  cpuCount: number;
  loadAvg: number[];
  process: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  system: {
    totalMemBytes: number;
    freeMemBytes: number;
  };
}

export interface DbMaintenanceRunResult {
  mode: "manual" | "scheduled";
  startedAt: string;
  completedAt: string;
  deletedLogs: number;
  deletedThreads: number;
  deletedMessages: number;
  deletedAttachmentRows: number;
  deletedFiles: number;
  deletedOrphanFiles: number;
}

function readBoolConfig(key: string, fallback: boolean): boolean {
  const raw = (getAppConfig(key) ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return fallback;
}

function readIntConfig(key: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(getAppConfig(key) ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function fileSizeIfExists(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function getDirectorySizeBytes(dirPath: string): number {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirectorySizeBytes(fullPath);
      } else if (entry.isFile()) {
        total += fileSizeIfExists(fullPath);
      }
    }
    return total;
  } catch {
    return 0;
  }
}

function listFilesRecursive(dirPath: string, out: string[]): void {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      listFilesRecursive(fullPath, out);
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
}

function pruneEmptyDirectories(root: string): void {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subPath = path.join(root, entry.name);
    pruneEmptyDirectories(subPath);
    try {
      const remaining = fs.readdirSync(subPath);
      if (remaining.length === 0) {
        fs.rmdirSync(subPath);
      }
    } catch {
      // Ignore concurrent filesystem changes.
    }
  }
}

function normalizeStoragePath(storagePath: string): string {
  return storagePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function deleteStorageFile(storagePath: string): boolean {
  const rel = normalizeStoragePath(storagePath);
  const abs = path.join(ATTACHMENTS_ROOT, rel);
  try {
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function getDbMaintenanceConfig(): DbMaintenanceConfig {
  return {
    enabled: readBoolConfig("db_maintenance_enabled", false),
    intervalHours: readIntConfig("db_maintenance_interval_hours", 24, 1, 24 * 30),
    logsRetentionDays: readIntConfig("db_maintenance_logs_retention_days", 30, 1, 3650),
    threadsRetentionDays: readIntConfig("db_maintenance_threads_retention_days", 90, 1, 3650),
    attachmentsRetentionDays: readIntConfig("db_maintenance_attachments_retention_days", 90, 1, 3650),
    cleanupLogs: readBoolConfig("db_maintenance_cleanup_logs", true),
    cleanupThreads: readBoolConfig("db_maintenance_cleanup_threads", false),
    cleanupAttachments: readBoolConfig("db_maintenance_cleanup_attachments", false),
    cleanupOrphanFiles: readBoolConfig("db_maintenance_cleanup_orphan_files", true),
    lastRunAt: getAppConfig("db_maintenance_last_run_at") ?? null,
  };
}

export function setDbMaintenanceConfig(partial: Partial<DbMaintenanceConfig>): DbMaintenanceConfig {
  const current = getDbMaintenanceConfig();
  const next: DbMaintenanceConfig = {
    ...current,
    ...partial,
    intervalHours: Math.min(24 * 30, Math.max(1, Math.floor(partial.intervalHours ?? current.intervalHours))),
    logsRetentionDays: Math.min(3650, Math.max(1, Math.floor(partial.logsRetentionDays ?? current.logsRetentionDays))),
    threadsRetentionDays: Math.min(3650, Math.max(1, Math.floor(partial.threadsRetentionDays ?? current.threadsRetentionDays))),
    attachmentsRetentionDays: Math.min(3650, Math.max(1, Math.floor(partial.attachmentsRetentionDays ?? current.attachmentsRetentionDays))),
  };

  setAppConfig("db_maintenance_enabled", next.enabled ? "1" : "0");
  setAppConfig("db_maintenance_interval_hours", String(next.intervalHours));
  setAppConfig("db_maintenance_logs_retention_days", String(next.logsRetentionDays));
  setAppConfig("db_maintenance_threads_retention_days", String(next.threadsRetentionDays));
  setAppConfig("db_maintenance_attachments_retention_days", String(next.attachmentsRetentionDays));
  setAppConfig("db_maintenance_cleanup_logs", next.cleanupLogs ? "1" : "0");
  setAppConfig("db_maintenance_cleanup_threads", next.cleanupThreads ? "1" : "0");
  setAppConfig("db_maintenance_cleanup_attachments", next.cleanupAttachments ? "1" : "0");
  setAppConfig("db_maintenance_cleanup_orphan_files", next.cleanupOrphanFiles ? "1" : "0");
  if (next.lastRunAt) {
    setAppConfig("db_maintenance_last_run_at", next.lastRunAt);
  }

  return getDbMaintenanceConfig();
}

export function getDbStorageStats(): DbStorageStats {
  const db = getDb();
  const dbPath = getDbFilePath();
  const dbBytes = fileSizeIfExists(dbPath);
  const walBytes = fileSizeIfExists(`${dbPath}-wal`);
  const shmBytes = fileSizeIfExists(`${dbPath}-shm`);
  const attachmentsBytes = getDirectorySizeBytes(ATTACHMENTS_ROOT);
  const pageSize = Number(db.pragma("page_size", { simple: true }) || 0);
  const pageCount = Number(db.pragma("page_count", { simple: true }) || 0);

  const tableNames = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;

  let dbstatAvailable = true;
  const tables: DbTableBreakdown[] = tableNames.map(({ name }) => {
    const escaped = name.replace(/"/g, '""');
    const row = db.prepare(`SELECT COUNT(*) as count FROM "${escaped}"`).get() as { count: number };

    let estimatedBytes: number | null = null;
    if (dbstatAvailable) {
      try {
        const sizeRow = db.prepare("SELECT SUM(pgsize) as bytes FROM dbstat WHERE name = ?").get(name) as { bytes: number | null } | undefined;
        estimatedBytes = Number(sizeRow?.bytes || 0);
      } catch {
        dbstatAvailable = false;
        estimatedBytes = null;
      }
    }

    return {
      table: name,
      rowCount: Number(row.count || 0),
      estimatedBytes,
    };
  });

  return {
    dbPath,
    dbBytes,
    walBytes,
    shmBytes,
    attachmentsBytes,
    totalManagedBytes: dbBytes + walBytes + shmBytes + attachmentsBytes,
    pageCount,
    pageSize,
    tables,
  };
}

export function getHostResourceUsage(): HostResourceUsage {
  const mem = process.memoryUsage();
  return {
    platform: os.platform(),
    uptimeSec: Math.floor(os.uptime()),
    cpuCount: os.cpus().length,
    loadAvg: os.loadavg(),
    process: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
    },
    system: {
      totalMemBytes: os.totalmem(),
      freeMemBytes: os.freemem(),
    },
  };
}

export function runDbMaintenance(mode: "manual" | "scheduled" = "manual", override?: Partial<DbMaintenanceConfig>): DbMaintenanceRunResult {
  const startedAt = new Date().toISOString();
  const config = { ...getDbMaintenanceConfig(), ...(override || {}) };
  const db = getDb();

  let deletedLogs = 0;
  let deletedThreads = 0;
  let deletedMessages = 0;
  let deletedAttachmentRows = 0;
  let deletedFiles = 0;
  let deletedOrphanFiles = 0;

  if (config.cleanupLogs) {
    deletedLogs += deleteLogsOlderThanDays(config.logsRetentionDays);
  }

  if (config.cleanupThreads) {
    const cutoff = `-${Math.max(1, Math.floor(config.threadsRetentionDays))} days`;
    const oldThreads = db
      .prepare("SELECT id FROM threads WHERE last_message_at < datetime('now', ?)")
      .all(cutoff) as Array<{ id: string }>;

    for (const t of oldThreads) {
      const msgCount = db.prepare("SELECT COUNT(*) as count FROM messages WHERE thread_id = ?").get(t.id) as { count: number };
      const attRows = db.prepare("SELECT storage_path FROM attachments WHERE thread_id = ?").all(t.id) as Array<{ storage_path: string }>;

      deletedMessages += Number(msgCount.count || 0);
      deletedAttachmentRows += attRows.length;

      for (const att of attRows) {
        if (deleteStorageFile(att.storage_path)) {
          deletedFiles += 1;
        }
      }

      deleteThread(t.id);
      deletedThreads += 1;
    }
  }

  if (config.cleanupAttachments) {
    const cutoff = `-${Math.max(1, Math.floor(config.attachmentsRetentionDays))} days`;
    const oldAttachments = db
      .prepare("SELECT id, storage_path FROM attachments WHERE created_at < datetime('now', ?)")
      .all(cutoff) as Array<{ id: string; storage_path: string }>;

    for (const att of oldAttachments) {
      if (deleteStorageFile(att.storage_path)) {
        deletedFiles += 1;
      }
      db.prepare("DELETE FROM attachments WHERE id = ?").run(att.id);
      deletedAttachmentRows += 1;
    }
  }

  if (config.cleanupOrphanFiles) {
    const files: string[] = [];
    listFilesRecursive(ATTACHMENTS_ROOT, files);
    const known = new Set(
      (db.prepare("SELECT storage_path FROM attachments").all() as Array<{ storage_path: string }>).map((r) => normalizeStoragePath(r.storage_path))
    );

    for (const filePath of files) {
      const rel = normalizeStoragePath(path.relative(ATTACHMENTS_ROOT, filePath));
      if (!known.has(rel)) {
        try {
          fs.unlinkSync(filePath);
          deletedOrphanFiles += 1;
        } catch {
          // Ignore races and permission edge cases.
        }
      }
    }

    pruneEmptyDirectories(ATTACHMENTS_ROOT);
  }

  const completedAt = new Date().toISOString();
  setAppConfig("db_maintenance_last_run_at", completedAt);

  return {
    mode,
    startedAt,
    completedAt,
    deletedLogs,
    deletedThreads,
    deletedMessages,
    deletedAttachmentRows,
    deletedFiles,
    deletedOrphanFiles,
  };
}

export function runDbMaintenanceIfDue(now = new Date()): DbMaintenanceRunResult | null {
  const cfg = getDbMaintenanceConfig();
  if (!cfg.enabled) return null;

  const lastRunMs = cfg.lastRunAt ? Date.parse(cfg.lastRunAt) : 0;
  const intervalMs = Math.max(1, cfg.intervalHours) * 60 * 60 * 1000;
  if (lastRunMs > 0 && now.getTime() - lastRunMs < intervalMs) {
    return null;
  }

  return runDbMaintenance("scheduled", cfg);
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
export const API_KEY_SCOPES = ["chat", "knowledge", "approvals", "threads", "logs"] as const;
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

export type SchedulerRunStatus =
  | "scheduled"
  | "queued"
  | "claimed"
  | "running"
  | "success"
  | "partial_success"
  | "failed"
  | "cancelled"
  | "timeout";

export type SchedulerTaskRunStatus =
  | "pending"
  | "skipped"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "timeout"
  | "retrying";

const SCHEDULER_RUN_TERMINAL = new Set<SchedulerRunStatus>(["success", "partial_success", "failed", "cancelled", "timeout"]);
const SCHEDULER_TASK_RUN_TERMINAL = new Set<SchedulerTaskRunStatus>(["success", "failed", "cancelled", "timeout", "skipped"]);

const SCHEDULER_RUN_TRANSITIONS: Record<SchedulerRunStatus, SchedulerRunStatus[]> = {
  scheduled: ["queued", "cancelled"],
  queued: ["claimed", "running", "cancelled", "timeout"],
  claimed: ["running", "failed", "cancelled", "timeout"],
  running: ["success", "partial_success", "failed", "cancelled", "timeout"],
  success: [],
  partial_success: [],
  failed: [],
  cancelled: [],
  timeout: [],
};

const SCHEDULER_TASK_RUN_TRANSITIONS: Record<SchedulerTaskRunStatus, SchedulerTaskRunStatus[]> = {
  pending: ["running", "skipped", "cancelled", "timeout", "retrying"],
  skipped: [],
  running: ["success", "failed", "cancelled", "timeout", "retrying"],
  success: [],
  failed: ["retrying"],
  cancelled: [],
  timeout: ["retrying"],
  retrying: ["running", "failed", "cancelled", "timeout"],
};

export function isValidSchedulerRunTransition(from: SchedulerRunStatus, to: SchedulerRunStatus): boolean {
  if (from === to) return true;
  return SCHEDULER_RUN_TRANSITIONS[from]?.includes(to) || false;
}

export function isValidSchedulerTaskRunTransition(from: SchedulerTaskRunStatus, to: SchedulerTaskRunStatus): boolean {
  if (from === to) return true;
  return SCHEDULER_TASK_RUN_TRANSITIONS[from]?.includes(to) || false;
}

export interface SchedulerScheduleRecord {
  id: string;
  schedule_key: string;
  name: string;
  owner_type: string;
  owner_id: string | null;
  handler_type: string;
  trigger_type: "cron" | "interval" | "once";
  trigger_expr: string;
  timezone: string;
  status: "active" | "paused" | "archived";
  max_concurrency: number;
  retry_policy_json: string | null;
  misfire_policy: string;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchedulerRunRecord {
  id: string;
  schedule_id: string;
  trigger_source: "timer" | "manual" | "api" | "recovery";
  planned_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  status: SchedulerRunStatus;
  attempt_no: number;
  correlation_id: string | null;
  summary_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SchedulerTaskRecord {
  id: string;
  schedule_id: string;
  task_key: string;
  name: string;
  handler_name: string;
  execution_mode: "sync" | "async" | "fanout";
  sequence_no: number;
  depends_on_task_id: string | null;
  timeout_sec: number | null;
  retry_policy_json: string | null;
  enabled: number;
  config_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchedulerTaskRunRecord {
  id: string;
  run_id: string;
  schedule_task_id: string;
  started_at: string | null;
  finished_at: string | null;
  status: SchedulerTaskRunStatus;
  attempt_no: number;
  output_json: string | null;
  error_code: string | null;
  error_message: string | null;
  log_ref: string | null;
  created_at: string;
}

export function listDueSchedulerSchedules(limit = 20): SchedulerScheduleRecord[] {
  return stmt(
    `SELECT s.*
     FROM scheduler_schedules s
     WHERE s.status = 'active'
       AND s.next_run_at IS NOT NULL
       AND datetime(s.next_run_at) <= datetime('now')
       AND NOT EXISTS (
         SELECT 1
         FROM scheduler_runs r
         WHERE r.schedule_id = s.id
           AND r.status IN ('queued', 'claimed', 'running')
       )
     ORDER BY s.next_run_at ASC
     LIMIT ?`
  ).all(limit) as SchedulerScheduleRecord[];
}

export function listRunnableSchedulerRuns(limit = 10): SchedulerRunRecord[] {
  return stmt(
    `SELECT *
     FROM scheduler_runs
     WHERE status = 'queued'
     ORDER BY created_at ASC
     LIMIT ?`
  ).all(limit) as SchedulerRunRecord[];
}

export function getSchedulerTasksForSchedule(scheduleId: string): SchedulerTaskRecord[] {
  return stmt(
    `SELECT *
     FROM scheduler_tasks
     WHERE schedule_id = ? AND enabled = 1
     ORDER BY sequence_no ASC, created_at ASC`
  ).all(scheduleId) as SchedulerTaskRecord[];
}

export function getSchedulerTaskRunsForRun(runId: string): SchedulerTaskRunRecord[] {
  return stmt(
    `SELECT tr.*
     FROM scheduler_task_runs tr
     JOIN scheduler_tasks t ON t.id = tr.schedule_task_id
     WHERE tr.run_id = ?
     ORDER BY t.sequence_no ASC, tr.created_at ASC`
  ).all(runId) as SchedulerTaskRunRecord[];
}

export function createSchedulerRun(scheduleId: string, triggerSource: "timer" | "manual" | "api" | "recovery" = "timer"): SchedulerRunRecord {
  const id = uuid();
  const correlationId = uuid();
  return getDb().prepare(
    `INSERT INTO scheduler_runs (
      id, schedule_id, trigger_source, planned_at, status, attempt_no, correlation_id
    ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'queued', 1, ?)
    RETURNING *`
  ).get(id, scheduleId, triggerSource, correlationId) as SchedulerRunRecord;
}

export function createSchedulerTaskRun(runId: string, scheduleTaskId: string): SchedulerTaskRunRecord {
  const id = uuid();
  return getDb().prepare(
    `INSERT INTO scheduler_task_runs (
      id, run_id, schedule_task_id, status, attempt_no
    ) VALUES (?, ?, ?, 'pending', 1)
    RETURNING *`
  ).get(id, runId, scheduleTaskId) as SchedulerTaskRunRecord;
}

export function updateSchedulerScheduleAfterDispatch(scheduleId: string, nextRunAt: string | null): void {
  getDb().prepare(
    `UPDATE scheduler_schedules
     SET next_run_at = ?,
         last_run_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(nextRunAt, scheduleId);
}

export function tryClaimSchedulerRun(runId: string, workerId: string, leaseSeconds = 60): boolean {
  const db = getDb();
  const tx = db.transaction(() => {
    const activeClaim = db.prepare(
      `SELECT run_id
       FROM scheduler_claims
       WHERE run_id = ? AND datetime(lease_expires_at) > datetime('now')`
    ).get(runId) as { run_id: string } | undefined;
    if (activeClaim) return false;

    db.prepare("DELETE FROM scheduler_claims WHERE run_id = ?").run(runId);
    db.prepare(
      `INSERT INTO scheduler_claims (run_id, worker_id, claimed_at, heartbeat_at, lease_expires_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, datetime('now', ?))`
    ).run(runId, workerId, `+${Math.max(1, leaseSeconds)} seconds`);

    const update = db.prepare(
      `UPDATE scheduler_runs
       SET status = 'claimed'
       WHERE id = ? AND status = 'queued'`
    ).run(runId);

    if (update.changes === 0) {
      db.prepare("DELETE FROM scheduler_claims WHERE run_id = ?").run(runId);
      return false;
    }
    return true;
  });
  return tx();
}

export function heartbeatSchedulerClaim(runId: string, workerId: string, leaseSeconds = 60): void {
  getDb().prepare(
    `UPDATE scheduler_claims
     SET heartbeat_at = CURRENT_TIMESTAMP,
         lease_expires_at = datetime('now', ?)
     WHERE run_id = ? AND worker_id = ?`
  ).run(`+${Math.max(1, leaseSeconds)} seconds`, runId, workerId);
}

export function releaseSchedulerClaim(runId: string): void {
  getDb().prepare("DELETE FROM scheduler_claims WHERE run_id = ?").run(runId);
}

export function setSchedulerRunStatus(runId: string, status: SchedulerRunStatus, errorMessage?: string | null): void {
  const current = stmt("SELECT status FROM scheduler_runs WHERE id = ?").get(runId) as { status: SchedulerRunStatus } | undefined;
  if (!current) return;
  if (!isValidSchedulerRunTransition(current.status, status)) {
    addLog({
      level: "warning",
      source: "scheduler.state",
      message: "Rejected invalid scheduler run status transition.",
      metadata: JSON.stringify({ runId, from: current.status, to: status }),
    });
    return;
  }

  const isTerminal = SCHEDULER_RUN_TERMINAL.has(status);
  getDb().prepare(
    `UPDATE scheduler_runs
     SET status = ?,
         started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
         finished_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE finished_at END,
         error_message = CASE WHEN ? IS NOT NULL THEN ? ELSE error_message END
     WHERE id = ?`
  ).run(status, status, isTerminal ? 1 : 0, errorMessage ?? null, errorMessage ?? null, runId);
}

export function setSchedulerTaskRunStatus(taskRunId: string, status: SchedulerTaskRunStatus, outputJson?: string | null, errorMessage?: string | null): void {
  const current = stmt("SELECT status FROM scheduler_task_runs WHERE id = ?").get(taskRunId) as { status: SchedulerTaskRunStatus } | undefined;
  if (!current) return;
  if (!isValidSchedulerTaskRunTransition(current.status, status)) {
    addLog({
      level: "warning",
      source: "scheduler.state",
      message: "Rejected invalid scheduler task-run status transition.",
      metadata: JSON.stringify({ taskRunId, from: current.status, to: status }),
    });
    return;
  }

  const isTerminal = SCHEDULER_TASK_RUN_TERMINAL.has(status);
  getDb().prepare(
    `UPDATE scheduler_task_runs
     SET status = ?,
         started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
         finished_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE finished_at END,
         output_json = CASE WHEN ? IS NOT NULL THEN ? ELSE output_json END,
         error_message = CASE WHEN ? IS NOT NULL THEN ? ELSE error_message END
     WHERE id = ?`
  ).run(status, status, isTerminal ? 1 : 0, outputJson ?? null, outputJson ?? null, errorMessage ?? null, errorMessage ?? null, taskRunId);
}

export function setSchedulerTaskRunLogRef(taskRunId: string, logRef: string | null): void {
  getDb().prepare(
    `UPDATE scheduler_task_runs
     SET log_ref = ?
     WHERE id = ?`
  ).run(logRef, taskRunId);
}

export function addSchedulerEvent(runId: string, eventType: string, message?: string, taskRunId?: string | null, metadataJson?: string | null): void {
  getDb().prepare(
    `INSERT INTO scheduler_events (run_id, task_run_id, event_type, message, metadata_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(runId, taskRunId ?? null, eventType, message ?? null, metadataJson ?? null);
}

export function getSchedulerOverviewStats(): {
  schedules_total: number;
  schedules_active: number;
  schedules_paused: number;
  runs_running: number;
  runs_failed_24h: number;
  runs_success_24h: number;
  runs_partial_24h: number;
} {
  const db = getDb();
  const schedules = db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused
     FROM scheduler_schedules`
  ).get() as { total: number; active: number | null; paused: number | null };

  const runs = db.prepare(
    `SELECT
       SUM(CASE WHEN status IN ('queued', 'claimed', 'running') THEN 1 ELSE 0 END) AS running,
       SUM(CASE WHEN status = 'failed' AND datetime(created_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS failed_24h,
       SUM(CASE WHEN status = 'success' AND datetime(created_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS success_24h,
       SUM(CASE WHEN status = 'partial_success' AND datetime(created_at) >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS partial_24h
     FROM scheduler_runs`
  ).get() as { running: number | null; failed_24h: number | null; success_24h: number | null; partial_24h: number | null };

  return {
    schedules_total: schedules.total || 0,
    schedules_active: schedules.active || 0,
    schedules_paused: schedules.paused || 0,
    runs_running: runs.running || 0,
    runs_failed_24h: runs.failed_24h || 0,
    runs_success_24h: runs.success_24h || 0,
    runs_partial_24h: runs.partial_24h || 0,
  };
}

export function listSchedulerSchedulesPaginated(limit = 50, offset = 0, status?: string): PaginatedResult<SchedulerScheduleRecord> {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(200, limit));
  const safeOffset = Math.max(0, offset);

  const where = status ? "WHERE status = ?" : "";
  const total = status
    ? (db.prepare(`SELECT COUNT(*) AS c FROM scheduler_schedules ${where}`).get(status) as { c: number }).c
    : (db.prepare("SELECT COUNT(*) AS c FROM scheduler_schedules").get() as { c: number }).c;

  const data = status
    ? db.prepare(`SELECT * FROM scheduler_schedules ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(status, safeLimit, safeOffset)
    : db.prepare("SELECT * FROM scheduler_schedules ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(safeLimit, safeOffset);

  return {
    data: data as SchedulerScheduleRecord[],
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + (data as SchedulerScheduleRecord[]).length < total,
  };
}

export function getSchedulerScheduleById(scheduleId: string): SchedulerScheduleRecord | null {
  const row = stmt("SELECT * FROM scheduler_schedules WHERE id = ?").get(scheduleId) as SchedulerScheduleRecord | undefined;
  return row || null;
}

export function updateSchedulerScheduleByKey(scheduleKey: string, args: {
  trigger_type?: "cron" | "interval" | "once";
  trigger_expr?: string;
  status?: "active" | "paused" | "archived";
  next_run_at?: string;
}): void {
  getDb().prepare(
    `UPDATE scheduler_schedules
     SET trigger_type = COALESCE(?, trigger_type),
         trigger_expr = COALESCE(?, trigger_expr),
         status = COALESCE(?, status),
         next_run_at = COALESCE(?, next_run_at),
         updated_at = CURRENT_TIMESTAMP
     WHERE schedule_key = ?`
  ).run(
    args.trigger_type ?? null,
    args.trigger_expr ?? null,
    args.status ?? null,
    args.next_run_at ?? null,
    scheduleKey
  );
}

export function updateSchedulerScheduleById(scheduleId: string, args: {
  name?: string;
  trigger_type?: "cron" | "interval" | "once";
  trigger_expr?: string;
  status?: "active" | "paused" | "archived";
  next_run_at?: string | null;
}): void {
  getDb().prepare(
    `UPDATE scheduler_schedules
     SET name = COALESCE(?, name),
         trigger_type = COALESCE(?, trigger_type),
         trigger_expr = COALESCE(?, trigger_expr),
         status = COALESCE(?, status),
         next_run_at = COALESCE(?, next_run_at),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    args.name ?? null,
    args.trigger_type ?? null,
    args.trigger_expr ?? null,
    args.status ?? null,
    args.next_run_at === undefined ? null : args.next_run_at,
    scheduleId,
  );
}

export function deleteSchedulerScheduleById(scheduleId: string): number {
  const result = getDb().prepare("DELETE FROM scheduler_schedules WHERE id = ?").run(scheduleId);
  return result.changes;
}

export function createSchedulerSchedule(args: {
  schedule_key: string;
  name: string;
  handler_type: string;
  trigger_type: "cron" | "interval" | "once";
  trigger_expr: string;
  status?: "active" | "paused" | "archived";
  owner_type?: string;
  owner_id?: string | null;
  max_concurrency?: number;
  retry_policy_json?: string | null;
  misfire_policy?: string;
  next_run_at?: string | null;
}): SchedulerScheduleRecord {
  const id = uuid();
  getDb().prepare(
    `INSERT INTO scheduler_schedules (
      id, schedule_key, name, owner_type, owner_id, handler_type,
      trigger_type, trigger_expr, timezone, status, max_concurrency,
      retry_policy_json, misfire_policy, next_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?, ?, ?)`
  ).run(
    id,
    args.schedule_key,
    args.name,
    args.owner_type || "user",
    args.owner_id ?? null,
    args.handler_type,
    args.trigger_type,
    args.trigger_expr,
    args.status || "active",
    Math.max(1, args.max_concurrency || 1),
    args.retry_policy_json ?? JSON.stringify({ strategy: "none", maxAttempts: 1 }),
    args.misfire_policy || "run_immediately",
    args.next_run_at ?? null,
  );

  const created = getSchedulerScheduleById(id);
  if (!created) {
    throw new Error("Failed to create scheduler schedule");
  }
  return created;
}

export function upsertSchedulerScheduleByKey(args: {
  schedule_key: string;
  name: string;
  handler_type: string;
  trigger_type: "cron" | "interval" | "once";
  trigger_expr: string;
  status: "active" | "paused" | "archived";
  owner_type?: string;
  owner_id?: string | null;
  max_concurrency?: number;
  retry_policy_json?: string | null;
  misfire_policy?: string;
  next_run_at?: string | null;
}): void {
  const existing = getDb().prepare("SELECT id FROM scheduler_schedules WHERE schedule_key = ?").get(args.schedule_key) as { id: string } | undefined;
  const id = existing?.id || uuid();

  getDb().prepare(
    `INSERT INTO scheduler_schedules (
      id, schedule_key, name, owner_type, owner_id, handler_type,
      trigger_type, trigger_expr, timezone, status, max_concurrency,
      retry_policy_json, misfire_policy, next_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?, ?, ?)
    ON CONFLICT(schedule_key) DO UPDATE SET
      name = excluded.name,
      owner_type = excluded.owner_type,
      owner_id = excluded.owner_id,
      handler_type = excluded.handler_type,
      trigger_type = excluded.trigger_type,
      trigger_expr = excluded.trigger_expr,
      status = excluded.status,
      max_concurrency = excluded.max_concurrency,
      retry_policy_json = excluded.retry_policy_json,
      misfire_policy = excluded.misfire_policy,
      next_run_at = COALESCE(excluded.next_run_at, scheduler_schedules.next_run_at),
      updated_at = CURRENT_TIMESTAMP`
  ).run(
    id,
    args.schedule_key,
    args.name,
    args.owner_type || "system",
    args.owner_id ?? null,
    args.handler_type,
    args.trigger_type,
    args.trigger_expr,
    args.status,
    Math.max(1, args.max_concurrency || 1),
    args.retry_policy_json ?? JSON.stringify({ strategy: "none", maxAttempts: 1 }),
    args.misfire_policy || "run_immediately",
    args.next_run_at ?? null,
  );
}

export function listSchedulerRunsBySchedule(scheduleId: string, limit = 25): SchedulerRunRecord[] {
  return stmt(
    `SELECT *
     FROM scheduler_runs
     WHERE schedule_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(scheduleId, Math.max(1, Math.min(200, limit))) as SchedulerRunRecord[];
}

export function listSchedulerRunsPaginated(limit = 50, offset = 0, status?: string, scheduleId?: string): PaginatedResult<SchedulerRunRecord> {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(200, limit));
  const safeOffset = Math.max(0, offset);
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (scheduleId) {
    clauses.push("schedule_id = ?");
    params.push(scheduleId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM scheduler_runs ${where}`).get(...params) as { c: number }).c;
  const data = db.prepare(`SELECT * FROM scheduler_runs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, safeLimit, safeOffset) as SchedulerRunRecord[];

  return {
    data,
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + data.length < total,
  };
}

export function getSchedulerRunById(runId: string): SchedulerRunRecord | null {
  const row = stmt("SELECT * FROM scheduler_runs WHERE id = ?").get(runId) as SchedulerRunRecord | undefined;
  return row || null;
}

export function getSchedulerRunWithContext(runId: string): {
  run: SchedulerRunRecord;
  schedule: SchedulerScheduleRecord | null;
  task_runs: SchedulerTaskRunRecord[];
} | null {
  const run = getSchedulerRunById(runId);
  if (!run) return null;
  return {
    run,
    schedule: getSchedulerScheduleById(run.schedule_id),
    task_runs: getSchedulerTaskRunsForRun(runId),
  };
}

export function updateSchedulerScheduleStatus(scheduleId: string, status: "active" | "paused" | "archived"): void {
  getDb().prepare(
    `UPDATE scheduler_schedules
     SET status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(status, scheduleId);
}

export function updateSchedulerTaskGraph(scheduleId: string, tasks: Array<{
  id?: string;
  task_key: string;
  name: string;
  handler_name: string;
  execution_mode?: "sync" | "async" | "fanout";
  sequence_no?: number;
  depends_on_task_id?: string | null;
  depends_on_task_key?: string | null;
  timeout_sec?: number | null;
  retry_policy_json?: string | null;
  enabled?: number;
  config_json?: string | null;
}>, replace = false): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO scheduler_tasks (
      id, schedule_id, task_key, name, handler_name, execution_mode,
      sequence_no, depends_on_task_id, timeout_sec, retry_policy_json, enabled, config_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    `UPDATE scheduler_tasks
     SET task_key = ?,
         name = ?,
         handler_name = ?,
         execution_mode = ?,
         sequence_no = ?,
         depends_on_task_id = ?,
         timeout_sec = ?,
         retry_policy_json = ?,
         enabled = ?,
         config_json = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND schedule_id = ?`
  );

  db.transaction(() => {
    const seenIds: string[] = [];
    const keyToId = new Map<string, string>();
    for (const task of tasks) {
      const id = task.id || uuid();
      seenIds.push(id);
      keyToId.set(task.task_key, id);
    }

    for (const task of tasks) {
      const id = (task.id && seenIds.includes(task.id)) ? task.id : keyToId.get(task.task_key) || uuid();
      const mode = task.execution_mode || "sync";
      const seq = Number.isFinite(task.sequence_no) ? Number(task.sequence_no) : 0;
      const enabled = task.enabled === 0 ? 0 : 1;
      const timeout = task.timeout_sec ?? null;
      const retry = task.retry_policy_json ?? null;
      const config = task.config_json ?? null;
      const dependsId = task.depends_on_task_id ?? (task.depends_on_task_key ? keyToId.get(task.depends_on_task_key) ?? null : null);

      const existing = db.prepare("SELECT id FROM scheduler_tasks WHERE id = ? AND schedule_id = ?").get(id, scheduleId) as { id: string } | undefined;
      if (existing) {
        update.run(task.task_key, task.name, task.handler_name, mode, seq, dependsId, timeout, retry, enabled, config, id, scheduleId);
      } else {
        insert.run(id, scheduleId, task.task_key, task.name, task.handler_name, mode, seq, dependsId, timeout, retry, enabled, config);
      }
    }

    if (replace) {
      if (seenIds.length === 0) {
        db.prepare("DELETE FROM scheduler_tasks WHERE schedule_id = ?").run(scheduleId);
      } else {
        const placeholders = seenIds.map(() => "?").join(",");
        db.prepare(`DELETE FROM scheduler_tasks WHERE schedule_id = ? AND id NOT IN (${placeholders})`).run(scheduleId, ...seenIds);
      }
    }
  })();
}

export function listEnabledSchedulerTaskHandlers(): Array<{ handler_name: string; count: number }> {
  return stmt(
    `SELECT handler_name, COUNT(*) as count
     FROM scheduler_tasks
     WHERE enabled = 1
     GROUP BY handler_name`
  ).all() as Array<{ handler_name: string; count: number }>;
}

export function getSchedulerQueueHealthMetrics(): {
  queued: number;
  claimed: number;
  running: number;
  failed_1h: number;
  success_1h: number;
  partial_1h: number;
  stale_claims: number;
} {
  const queue = stmt(
    `SELECT
       SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
       SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed,
       SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
       SUM(CASE WHEN status = 'failed' AND datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) AS failed_1h,
       SUM(CASE WHEN status = 'success' AND datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) AS success_1h,
       SUM(CASE WHEN status = 'partial_success' AND datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) AS partial_1h
     FROM scheduler_runs`
  ).get() as {
    queued: number | null;
    claimed: number | null;
    running: number | null;
    failed_1h: number | null;
    success_1h: number | null;
    partial_1h: number | null;
  };

  const staleClaims = stmt(
    `SELECT COUNT(*) AS c
     FROM scheduler_claims
     WHERE datetime(lease_expires_at) <= datetime('now')`
  ).get() as { c: number };

  return {
    queued: queue.queued || 0,
    claimed: queue.claimed || 0,
    running: queue.running || 0,
    failed_1h: queue.failed_1h || 0,
    success_1h: queue.success_1h || 0,
    partial_1h: queue.partial_1h || 0,
    stale_claims: staleClaims.c || 0,
  };
}
