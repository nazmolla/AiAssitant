import { getDb } from "./connection";
import { stmt } from "./query-helpers";
import { v4 as uuid } from "uuid";

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
