import { getDb, cachedStmt as _cachedStmt } from "./connection";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import { encryptField, decryptField } from "./crypto";
import { appCache, CACHE_KEYS } from "@/lib/cache";

/** Thin wrapper that passes the (patchable) `getDb` import to the cache */
function stmt(sql: string) { return _cachedStmt(sql, getDb); }

// ─── Channels ────────────────────────────────────────────────

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
 * Used by webhook/Discord handlers — the channel owner is assumed to be the user.
 */
export function getChannelOwnerId(channelId: string): string | null {
  const row = stmt("SELECT user_id FROM channels WHERE id = ?").get(channelId) as { user_id: string | null } | undefined;
  return row?.user_id ?? null;
}

// ─── Channel User Mappings ───────────────────────────────────

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
