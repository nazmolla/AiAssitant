/**
 * Integration tests — Notifications API (/api/notifications)
 *
 * Tests notification listing (merged with approvals), mark-read, mark-all-read,
 * dismiss actions, and unread count.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/notifications/route";
import {
  createNotification,
  createApprovalRequest,
  createThread,
  updateThreadStatus,
  listNotifications,
  countUnreadNotifications,
  markAllNotificationsRead,
  dismissAllUnreadNotifications,
  allowedTypesForLevel,
} from "@/lib/db/queries";

let adminId: string;
let userId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "admin-notif@test.com", role: "admin" });
  userId = seedTestUser({ email: "user-notif@test.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/notifications", () => {
  test("returns empty state for user with no notifications", async () => {
    setMockUser({ id: userId, email: "user-notif@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/notifications");
    const res = await GET(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.notifications).toEqual([]);
    expect(body.unreadCount).toBe(0);
  });

  test("returns notifications for the current user", async () => {
    setMockUser({ id: adminId, email: "admin-notif@test.com", role: "admin" });
    createNotification({
      userId: adminId,
      type: "info",
      title: "Test notification",
      body: "Some body text",
    });
    const req = new NextRequest("http://localhost/api/notifications");
    const res = await GET(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.notifications.length).toBeGreaterThanOrEqual(1);
    const notif = body.notifications.find((n: { title: string }) => n.title === "Test notification");
    expect(notif).toBeDefined();
    // id is now an integer (from agent_logs.id), not a UUID string
    expect(typeof notif.id).toBe("number");
    expect(body.unreadCount).toBeGreaterThanOrEqual(1);
  });

  test("includes pending approvals for admin users", async () => {
    setMockUser({ id: adminId, email: "admin-notif@test.com", role: "admin" });
    const thread = createThread("test thread", adminId);
    updateThreadStatus(thread.id, "awaiting_approval");
    createApprovalRequest({
      thread_id: thread.id,
      tool_name: "test_tool",
      args: "{}",
      reasoning: "test reasoning",
      source: "proactive",
    });
    const req = new NextRequest("http://localhost/api/notifications");
    const res = await GET(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.approvals.length).toBeGreaterThanOrEqual(1);
  });
});

describe("POST /api/notifications — markRead", () => {
  test("marks a notification as read", async () => {
    setMockUser({ id: adminId, email: "admin-notif@test.com", role: "admin" });
    const notif = createNotification({
      userId: adminId,
      type: "system_error",
      title: "Error happened",
    });
    const req = new NextRequest("http://localhost/api/notifications", {
      method: "POST",
      body: JSON.stringify({ action: "markRead", notificationId: notif.id }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/notifications — markAllRead", () => {
  test("marks all notifications as read", async () => {
    setMockUser({ id: adminId, email: "admin-notif@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/notifications", {
      method: "POST",
      body: JSON.stringify({ action: "markAllRead" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/notifications — dismiss", () => {
  test("deletes a notification", async () => {
    setMockUser({ id: adminId, email: "admin-notif@test.com", role: "admin" });
    const notif = createNotification({
      userId: adminId,
      type: "info",
      title: "Dismissable",
    });
    const req = new NextRequest("http://localhost/api/notifications", {
      method: "POST",
      body: JSON.stringify({ action: "dismiss", notificationId: notif.id }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe("Notifications/Logs merge — notifications stored in agent_logs", () => {
  test("createNotification stores notification as agent_logs row with notify=1", () => {
    const notif = createNotification({
      userId: adminId,
      type: "warning",
      title: "Merge test notification",
      body: "Full body text",
    });
    // id is now integer from agent_logs, not UUID string
    expect(typeof notif.id).toBe("number");
    expect(notif.id).toBeGreaterThan(0);
    expect(notif.title).toBe("Merge test notification");
    expect(notif.body).toBe("Full body text");
    expect(notif.read).toBe(0);
    expect(notif.type).toBe("warning");
  });

  test("listNotifications only returns notify=1 rows", () => {
    // createNotification adds a notify=1 row; dashboard shows all, bell shows notify=1 only
    const before = createNotification({ userId: adminId, type: "info", title: "Bell-only entry" });
    const notifs = listNotifications(adminId);
    expect(notifs.some((n) => n.id === before.id)).toBe(true);
  });

  test("markAllNotificationsRead zeroes unread count for user", () => {
    createNotification({ userId: adminId, type: "info", title: "Unread one" });
    createNotification({ userId: adminId, type: "info", title: "Unread two" });
    expect(countUnreadNotifications(adminId)).toBeGreaterThan(0);
    markAllNotificationsRead(adminId);
    expect(countUnreadNotifications(adminId)).toBe(0);
  });

  test("dismissAllUnreadNotifications removes notifications from the bell entirely", () => {
    createNotification({ userId: userId, type: "info", title: "Dismiss me" });
    createNotification({ userId: userId, type: "warning", title: "Dismiss me too" });
    expect(listNotifications(userId).length).toBeGreaterThan(0);

    dismissAllUnreadNotifications(userId);

    // After dismiss, unread count is 0
    expect(countUnreadNotifications(userId)).toBe(0);
    // And they no longer appear in the bell (notify=0)
    expect(listNotifications(userId).filter(n => n.read === 0).length).toBe(0);
  });

  test("allowedTypesForLevel returns null for 'low' (show all)", () => {
    expect(allowedTypesForLevel("low")).toBeNull();
  });

  test("allowedTypesForLevel('high') excludes info, warning, proactive_action", () => {
    const allowed = allowedTypesForLevel("high")!;
    expect(allowed).not.toContain("info");
    expect(allowed).not.toContain("warning");
    expect(allowed).not.toContain("proactive_action");
    expect(allowed).toContain("tool_error");
    expect(allowed).toContain("channel_error");
    expect(allowed).toContain("system_error");
    expect(allowed).toContain("approval_required");
  });

  test("listNotifications with minLevel='high' excludes info and warning", () => {
    createNotification({ userId: userId, type: "info", title: "Info should be hidden" });
    createNotification({ userId: userId, type: "tool_error", title: "Error should show" });

    const filtered = listNotifications(userId, 50, "high");
    expect(filtered.some(n => n.type === "info")).toBe(false);
    expect(filtered.some(n => n.type === "warning")).toBe(false);
    expect(filtered.some(n => n.type === "tool_error")).toBe(true);
  });

  test("countUnreadNotifications with minLevel='disaster' only counts system_error and approval_required", () => {
    // Dismiss everything first for a clean slate
    dismissAllUnreadNotifications(userId);

    createNotification({ userId: userId, type: "info", title: "Info" });
    createNotification({ userId: userId, type: "warning", title: "Warning" });
    createNotification({ userId: userId, type: "system_error", title: "Critical" });

    const count = countUnreadNotifications(userId, "disaster");
    expect(count).toBe(1); // only system_error
  });
});
