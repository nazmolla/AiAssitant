import { getDb } from "./connection";
import { stmt } from "./query-helpers";

// ─── Notifications (stored as agent_logs rows with notify=1) ────────────────
//
// Notifications are NOT a separate table. They are agent_logs entries with
// notify=1. The dashboard shows all agent_logs; the notification bell filters
// agent_logs WHERE notify=1.
//
// The `notifications` table remains in the schema for backward compatibility
// but is no longer written to.

export type NotificationType =
  | "approval_required"
  | "tool_error"
  | "proactive_action"
  | "channel_error"
  | "system_error"
  | "warning"
  | "info";

/**
 * Maps notification types to the minimum notification_level required to show them.
 * notification_level hierarchy (ascending): low → medium → high → disaster
 */
export const NOTIFICATION_TYPE_LEVELS: Record<NotificationType, string> = {
  info: "low",
  proactive_action: "medium",
  warning: "medium",
  tool_error: "high",
  channel_error: "high",
  system_error: "disaster",
  approval_required: "disaster",
};

const LEVEL_ORDER = ["low", "medium", "high", "disaster"] as const;
type Level = (typeof LEVEL_ORDER)[number];

/**
 * Returns the notification types allowed for a given minimum level.
 * e.g. allowedTypesForLevel("high") → ["tool_error","channel_error","system_error","approval_required"]
 * Returns null when all types are allowed (level "low").
 */
export function allowedTypesForLevel(minLevel: string): NotificationType[] | null {
  const idx = LEVEL_ORDER.indexOf(minLevel as Level);
  if (idx <= 0) return null; // "low" = show everything
  return (Object.entries(NOTIFICATION_TYPE_LEVELS) as [NotificationType, string][])
    .filter(([, typeLevel]) => LEVEL_ORDER.indexOf(typeLevel as Level) >= idx)
    .map(([type]) => type);
}

export interface NotificationRecord {
  /** Integer ID from agent_logs */
  id: number;
  user_id: string | null;
  type: NotificationType | null;
  title: string;
  body: string | null;
  metadata: string | null;
  read: number;
  created_at: string;
}

function notifyTypeToLogLevel(type: NotificationType): string {
  if (type === "system_error" || type === "tool_error" || type === "channel_error") return "error";
  if (type === "warning") return "warning";
  return "info";
}

/**
 * Create an in-app notification by inserting an agent_logs row with notify=1.
 * Used by notify() in notifications.ts and the channel_notify tool.
 */
export function createNotification(n: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  metadata?: string | null;
}): NotificationRecord {
  if (!n.userId) {
    throw new Error("createNotification: userId is required");
  }
  const level = notifyTypeToLogLevel(n.type);
  const row = getDb()
    .prepare(
      `INSERT INTO agent_logs (level, source, message, metadata, notify, notify_read, notify_type, notify_user_id, notify_body)
       VALUES (?, 'notification', ?, ?, 1, 0, ?, ?, ?)
       RETURNING id, notify_user_id as user_id, notify_type as type, message as title, notify_body as body, metadata, notify_read as read, created_at`
    )
    .get(level, n.title, n.metadata ?? null, n.type, n.userId, n.body ?? null) as NotificationRecord;
  return row;
}

export function listNotifications(userId: string, limit = 50, minLevel?: string): NotificationRecord[] {
  const allowed = minLevel ? allowedTypesForLevel(minLevel) : null;
  const typeClause = allowed
    ? `AND (notify_type IN (${allowed.map(() => "?").join(",")}) OR notify_type IS NULL)`
    : "";
  const params: (string | number)[] = allowed
    ? [userId, ...allowed, limit]
    : [userId, limit];
  return getDb()
    .prepare(
      `SELECT id, notify_user_id as user_id, notify_type as type, message as title, notify_body as body,
              metadata, notify_read as read, created_at
       FROM agent_logs
       WHERE notify = 1 AND notify_user_id = ? ${typeClause}
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(...params) as NotificationRecord[];
}

export function countUnreadNotifications(userId: string, minLevel?: string): number {
  const allowed = minLevel ? allowedTypesForLevel(minLevel) : null;
  const typeClause = allowed
    ? `AND (notify_type IN (${allowed.map(() => "?").join(",")}) OR notify_type IS NULL)`
    : "";
  const params: (string | number)[] = allowed ? [userId, ...allowed] : [userId];
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM agent_logs WHERE notify = 1 AND notify_user_id = ? AND notify_read = 0 ${typeClause}`
    )
    .get(...params) as { count: number };
  return row.count;
}

export function markNotificationRead(id: string | number, userId: string): void {
  const numId = typeof id === "string" ? parseInt(id, 10) : id;
  getDb().prepare(
    "UPDATE agent_logs SET notify_read = 1 WHERE id = ? AND notify_user_id = ? AND notify = 1"
  ).run(numId, userId);
}

export function markAllNotificationsRead(userId: string): void {
  getDb().prepare(
    "UPDATE agent_logs SET notify_read = 1 WHERE notify = 1 AND notify_user_id = ? AND notify_read = 0"
  ).run(userId);
}

/**
 * Dismiss ALL visible notifications — sets notify=0 so the bell is entirely cleared.
 * Includes both unread (notify_read=0) and previously-read (notify_read=1) rows.
 * Rows remain in agent_logs and are visible in the dashboard.
 */
export function dismissAllNotifications(userId: string): void {
  getDb().prepare(
    "UPDATE agent_logs SET notify = 0, notify_read = 1 WHERE notify = 1 AND notify_user_id = ?"
  ).run(userId);
}

/** @deprecated Use dismissAllNotifications — kept for backward compat */
export function dismissAllUnreadNotifications(userId: string): void {
  dismissAllNotifications(userId);
}

/**
 * Dismiss a notification — sets notify=0 so it no longer appears in the bell.
 * The log row remains visible in the dashboard.
 */
export function deleteNotification(id: string | number, userId: string): void {
  const numId = typeof id === "string" ? parseInt(id, 10) : id;
  getDb().prepare(
    "UPDATE agent_logs SET notify = 0 WHERE id = ? AND notify_user_id = ?"
  ).run(numId, userId);
}

/**
 * No-op: old notifications are just old logs — log cleanup handles them.
 * Kept for interface compatibility.
 */
export function deleteOldNotifications(_daysOld = 30): number {
  return 0;
}
