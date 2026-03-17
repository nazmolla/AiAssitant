/**
 * notifications.ts — App-level notification infrastructure.
 *
 * In-app notifications (bell icon) are ALWAYS created regardless of
 * the user's notification_level threshold.
 *
 * External channel delivery (email, Discord, WhatsApp) is gated by
 * the user's notification_level threshold setting.
 */

import {
  listUsersWithPermissions,
  addLog,
  getUserProfile,
  getUserById,
  createNotification,
} from "@/lib/db";
import type { NotificationType } from "@/lib/db";
import { sendChannelNotification } from "@/lib/channels/notify";

export type NotificationLevel = "low" | "medium" | "high" | "disaster";

export interface NotificationDependencies {
  listUsersWithPermissions: typeof listUsersWithPermissions;
  addLog: typeof addLog;
  getUserProfile: typeof getUserProfile;
  getUserById: typeof getUserById;
  createNotification: typeof createNotification;
  sendChannelNotification: typeof sendChannelNotification;
}

const defaultNotificationDependencies: NotificationDependencies = {
  listUsersWithPermissions,
  addLog,
  getUserProfile,
  getUserById,
  createNotification,
  sendChannelNotification,
};

const NOTIFICATION_LEVEL_ORDER: NotificationLevel[] = ["disaster", "high", "medium", "low"];

export function normalizeNotificationLevel(value: unknown): NotificationLevel {
  if (typeof value !== "string") return "disaster";
  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "disaster") {
    return normalized;
  }
  return "disaster";
}

export function shouldNotifyForLevel(userThreshold: NotificationLevel, eventLevel: NotificationLevel): boolean {
  const thresholdIndex = NOTIFICATION_LEVEL_ORDER.indexOf(userThreshold);
  const eventIndex = NOTIFICATION_LEVEL_ORDER.indexOf(eventLevel);
  if (thresholdIndex < 0 || eventIndex < 0) return eventLevel === "disaster";
  return eventIndex <= thresholdIndex;
}

export function getUserNotificationLevel(
  userId: string,
  deps: Pick<NotificationDependencies, "getUserProfile"> = defaultNotificationDependencies
): NotificationLevel {
  const profile = deps.getUserProfile(userId);
  return normalizeNotificationLevel(profile?.notification_level);
}

export interface NotifyOptions {
  level?: NotificationLevel;
  userId?: string;
  notificationType?: NotificationType;
}

/**
 * Unified notification entry point.
 *
 * 1. ALWAYS creates an in-app notification (bell icon) regardless of threshold.
 * 2. Sends via external channels (Discord/WhatsApp/email) ONLY if the event
 *    level meets the user's notification_level threshold.
 *
 * Returns true if at least one channel delivery succeeded.
 */
export async function notify(
  message: string,
  subject = "Nexus Notification",
  options: NotifyOptions = {},
  deps: NotificationDependencies = defaultNotificationDependencies
): Promise<boolean> {
  const level = options.level ?? "disaster";

  let targetUser: { id: string; email: string } | undefined;

  if (options.userId) {
    const specific = deps.getUserById(options.userId);
    if (specific) {
      targetUser = { id: specific.id, email: specific.email };
    }
  }

  if (!targetUser) {
    const admins = deps.listUsersWithPermissions().filter((u) => u.role === "admin" && u.enabled === 1);
    if (admins.length === 0) return false;
    const admin = admins[0];
    targetUser = { id: admin.id, email: admin.email };
  }

  // ── In-app notification — ALWAYS created ───────────────────────
  try {
    const nType: NotificationType = options.notificationType
      ?? (level === "disaster" || level === "high" ? "system_error" : "info");
    deps.createNotification({
      userId: targetUser.id,
      type: nType,
      title: subject,
      body: message,
    });
  } catch {
    // Non-critical — don't let notification persistence break delivery
  }

  // ── Channel delivery — gated by user threshold ────────────────
  const threshold = getUserNotificationLevel(targetUser.id, deps);
  if (!shouldNotifyForLevel(threshold, level)) {
    deps.addLog({
      level: "info",
      source: "notifications",
      message: `Channel delivery suppressed by user threshold (event=${level}, threshold=${threshold}).`,
      metadata: JSON.stringify({ userId: targetUser.id, subject }),
    });
    return false;
  }

  return deps.sendChannelNotification(targetUser.id, targetUser.email, message, subject);
}

/** Backward-compatible alias for notify(). */
export const notifyAdmin = notify;
