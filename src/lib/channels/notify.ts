/**
 * channels/notify.ts — External channel delivery (Discord, WhatsApp, email).
 *
 * This module handles ONLY the transport layer for sending notifications via
 * external communication channels. Notification lifecycle (in-app persistence,
 * threshold filtering, user resolution) lives in @/lib/notifications.
 *
 * Re-exports from @/lib/notifications for backward compatibility.
 */

import {
  listChannels,
  listChannelUserMappings,
  addLog,
} from "@/lib/db";
import {
  createDefaultCommunicationChannelFactory,
  type CommunicationChannelFactory,
  type ChannelFactoryDependencies,
} from "@/lib/channels/communication-channel-factory";

// Re-export from canonical location for backward compatibility
export { notify, notifyAdmin, getUserNotificationLevel, shouldNotifyForLevel, normalizeNotificationLevel } from "@/lib/notifications";
export type { NotificationLevel, NotifyOptions } from "@/lib/notifications";

export interface ChannelDispatchDependencies extends ChannelFactoryDependencies {
  channelFactory?: CommunicationChannelFactory;
  listChannelsFn?: typeof listChannels;
  listChannelUserMappingsFn?: typeof listChannelUserMappings;
  addLogFn?: typeof addLog;
}

/**
 * Send a notification via external channels (Discord, WhatsApp, email).
 *
 * Called by the app-level notify() after the event passes the user's
 * notification_level threshold. This function does NOT check thresholds.
 */
export async function sendChannelNotification(
  userId: string,
  email: string,
  message: string,
  subject: string,
  deps: ChannelDispatchDependencies = {},
): Promise<boolean> {
  const listChannelsFn = deps.listChannelsFn ?? listChannels;
  const listChannelUserMappingsFn = deps.listChannelUserMappingsFn ?? listChannelUserMappings;
  const addLogFn = deps.addLogFn ?? addLog;
  const channelFactory = deps.channelFactory ?? createDefaultCommunicationChannelFactory(deps);

  const channels = listChannelsFn(userId).filter((c) => !!c.enabled);

  // Prefer IM channels first
  const imChannels = channels.filter((c) => ["whatsapp", "discord", "telegram", "slack", "teams"].includes(c.channel_type));
  for (const channel of imChannels) {
    const mappings = listChannelUserMappingsFn(channel.id);
    const userMapping = mappings.find((m) => m.user_id === userId);
    if (!userMapping) continue;

    try {
      const instance = channelFactory.create(channel);
      if (!instance.canSend({ userId, externalRecipientId: userMapping.external_id, subject, message })) continue;
      await instance.send({ userId, externalRecipientId: userMapping.external_id, subject, message });
      return true;
    } catch (err) {
      addLogFn({
        level: "warn",
        source: "channels",
        message: `Failed channel notification via ${channel.channel_type}: ${err}`,
        metadata: JSON.stringify({ channelId: channel.id, userId }),
      });
    }
  }

  // Fallback to email
  if (!email?.trim()) return false;

  const emailChannel = channels.find((c) => c.channel_type === "email");
  if (!emailChannel) return false;

  try {
    const instance = channelFactory.create(emailChannel);
    if (!instance.canSend({ userId, emailRecipient: email, subject, message })) return false;
    await instance.send({ userId, emailRecipient: email, subject, message });
    return true;
  } catch (err) {
    addLogFn({
      level: "warn",
      source: "channels",
      message: `Failed channel email notification fallback: ${err}`,
      metadata: JSON.stringify({ channelId: emailChannel.id, userId }),
    });
  }

  return false;
}
