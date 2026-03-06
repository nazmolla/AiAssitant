import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import {
  listNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  listPendingApprovals,
  listPendingApprovalsForUser,
  cleanStaleApprovals,
} from "@/lib/db";

/**
 * GET /api/notifications
 * Returns notifications + pending approvals merged into a unified feed.
 */
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const userId = auth.user.id;
  const isAdmin = auth.user.role === "admin";

  // Fetch persistent notifications
  const notifications = listNotifications(userId);
  const unreadCount = countUnreadNotifications(userId);

  // Clean stale approvals in bulk (O(1) queries, not O(n))
  cleanStaleApprovals();

  // Fetch pending approvals — single JOIN query for non-admins
  const approvals = isAdmin
    ? listPendingApprovals()
    : listPendingApprovalsForUser(userId);

  return NextResponse.json({
    notifications,
    approvals,
    unreadCount: unreadCount + approvals.length,
  });
}

/**
 * POST /api/notifications
 * Actions: markRead, markAllRead, dismiss
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { action, notificationId } = body as {
    action: string;
    notificationId?: string;
  };

  const userId = auth.user.id;

  switch (action) {
    case "markRead":
      if (!notificationId) return NextResponse.json({ error: "Missing notificationId" }, { status: 400 });
      markNotificationRead(notificationId, userId);
      return NextResponse.json({ ok: true });

    case "markAllRead":
      markAllNotificationsRead(userId);
      return NextResponse.json({ ok: true });

    case "dismiss":
      if (!notificationId) return NextResponse.json({ error: "Missing notificationId" }, { status: 400 });
      deleteNotification(notificationId, userId);
      return NextResponse.json({ ok: true });

    default:
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
}
