import { getDb } from "./connection";
import { stmt } from "./query-helpers";
import { v4 as uuid } from "uuid";
import { appCache, CACHE_KEYS } from "@/lib/cache";

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
    // Strict whitelist check — key must be an exact match in VALID_FIELDS (prevents SQL injection via key)
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
