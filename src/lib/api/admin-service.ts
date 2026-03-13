import { apiClient } from "./client";

export const adminService = {
  // User Management
  getUsers: () => apiClient.get<unknown>("/api/admin/users"),
  updateUser: (user: unknown) => apiClient.put("/api/admin/users", user),
  deleteUser: (id: string) => apiClient.delete(`/api/admin/users?id=${encodeURIComponent(id)}`),

  // DB Management
  getDbStats: () => apiClient.get<unknown>("/api/config/db-management"),
  vacuumDb: () => apiClient.post("/api/config/db-management", { action: "vacuum" }),
  walCheckpoint: () => apiClient.post("/api/config/db-management", { action: "checkpoint" }),

  // Logs
  getLogs: (params?: { limit?: number; level?: string; source?: string; after_id?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.level) qs.set("level", params.level);
    if (params?.source) qs.set("source", params.source);
    if (params?.after_id) qs.set("after_id", String(params.after_id));
    const q = qs.toString();
    return apiClient.get<unknown>(`/api/logs${q ? `?${q}` : ""}`);
  },

  // Approvals
  getApprovals: () => apiClient.get<unknown>("/api/approvals"),
  respondApproval: (id: string, action: "approve" | "reject") =>
    apiClient.post("/api/approvals", { id, action }),

  // Notifications
  getNotifications: () => apiClient.get<unknown>("/api/notifications"),
  markNotificationRead: (id: string) => apiClient.put("/api/notifications", { id, read: true }),
  markAllNotificationsRead: () => apiClient.put("/api/notifications", { all: true }),
  deleteNotification: (id: string) => apiClient.delete(`/api/notifications?id=${encodeURIComponent(id)}`),
  clearNotifications: () => apiClient.delete("/api/notifications?all=true"),
};
