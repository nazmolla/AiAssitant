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
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("api.notifications");

function isApprovalCenterSource(source: string | null | undefined): boolean {
  const value = (source || "").toLowerCase();
  return value === "proactive" || value.startsWith("proactive:") || value === "email" || value.startsWith("email:");
}

/**
 * GET /api/notifications
 * Returns notifications + pending approvals merged into a unified feed.
 */
export async function GET() {
  const t0 = Date.now();
  log.enter("GET /api/notifications");
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

  const filteredApprovals = approvals.filter((approval) => isApprovalCenterSource(approval.source));

  log.exit("GET /api/notifications", { notificationCount: notifications.length, approvalCount: filteredApprovals.length }, Date.now() - t0);
  return NextResponse.json({
    notifications,
    approvals: filteredApprovals,
    unreadCount: unreadCount + filteredApprovals.length,
  });
}

/**
 * POST /api/notifications
 * Actions: markRead, markAllRead, dismiss
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  log.enter("POST /api/notifications");
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
      markNotificationRead(String(notificationId), userId);
      log.exit("POST /api/notifications", { action }, Date.now() - t0);
      return NextResponse.json({ ok: true });

    case "markAllRead":
      markAllNotificationsRead(userId);
      log.exit("POST /api/notifications", { action }, Date.now() - t0);
      return NextResponse.json({ ok: true });

    case "dismiss":
      if (!notificationId) return NextResponse.json({ error: "Missing notificationId" }, { status: 400 });
      deleteNotification(String(notificationId), userId);
      log.exit("POST /api/notifications", { action }, Date.now() - t0);
      return NextResponse.json({ ok: true });

    default:
      log.exit("POST /api/notifications", { action, ok: false }, Date.now() - t0);
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
}
