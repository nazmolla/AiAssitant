"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/components/theme-provider";
import { useToast } from "@/hooks/use-toast";

interface UserPermissions {
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

interface ManagedUser {
  id: string;
  email: string;
  display_name: string;
  provider_id: string;
  role: string;
  enabled: number;
  created_at: string;
  permissions: UserPermissions;
}

const PERM_LABELS: { key: keyof Omit<UserPermissions, "user_id">; label: string; description: string }[] = [
  { key: "chat", label: "Chat", description: "Use the chat interface" },
  { key: "knowledge", label: "Knowledge", description: "Manage knowledge vault" },
  { key: "dashboard", label: "Dashboard", description: "View activity logs" },
  { key: "approvals", label: "Approvals", description: "Manage tool approvals" },
  { key: "mcp_servers", label: "MCP Servers", description: "Add/manage MCP servers" },
  { key: "channels", label: "Channels", description: "Configure communication channels" },
  { key: "llm_config", label: "LLM Config", description: "Manage LLM providers" },
  { key: "screen_sharing", label: "Screen Sharing", description: "Share screen with the agent" },
];

export function UserManagement() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const { formatDate } = useTheme();
  const { toastSnackbar, showToast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateUser = async (userId: string, updates: Record<string, unknown>) => {
    setSaving(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...updates }),
      });
      if (res.ok) {
        await load();
      } else {
        const err = await res.json();
        showToast(err.error || "Failed to update user");
      }
    } catch {
      showToast("Failed to update user");
    } finally {
      setSaving(null);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        setDeleteConfirm(null);
        await load();
      } else {
        const err = await res.json();
        showToast(err.error || "Failed to delete user");
      }
    } catch {
      showToast("Failed to delete user");
    }
  };

  const togglePermission = (user: ManagedUser, key: keyof Omit<UserPermissions, "user_id">) => {
    const newValue = user.permissions[key] ? 0 : 1;
    updateUser(user.id, { permissions: { [key]: newValue } });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-6 w-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-sm text-muted-foreground">
        <span>{users.length} user{users.length !== 1 ? "s" : ""} registered</span>
        <span className="text-muted-foreground/30">•</span>
        <span>{users.filter(u => u.role === "admin").length} admin{users.filter(u => u.role === "admin").length !== 1 ? "s" : ""}</span>
        <span className="text-muted-foreground/30">•</span>
        <span>{users.filter(u => u.enabled).length} active</span>
      </div>

      {/* User List */}
      {users.map((user) => (
        <Card key={user.id} className={`glass-card transition-all ${!user.enabled ? "opacity-50" : ""}`}>
          <CardHeader className="pb-3">
            <div className="hidden md:flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Avatar */}
                <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold ${
                  user.role === "admin"
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "bg-muted text-muted-foreground border border-border"
                }`}>
                  {(user.display_name || user.email)[0].toUpperCase()}
                </div>

                <div>
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    {user.display_name || user.email.split("@")[0]}
                    <Badge
                      variant={user.role === "admin" ? "default" : "secondary"}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {user.role}
                    </Badge>
                    {!user.enabled && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                        disabled
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {user.email} · {user.provider_id} · joined {formatDate(user.created_at, { year: "numeric", month: "short", day: "numeric" })}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setExpandedUser(expandedUser === user.id ? null : user.id)}
                >
                  {expandedUser === user.id ? "▲ Collapse" : "▼ Permissions"}
                </Button>
              </div>
            </div>

            <div className="md:hidden space-y-3">
              <div className="flex items-start gap-3">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                  user.role === "admin"
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "bg-muted text-muted-foreground border border-border"
                }`}>
                  {(user.display_name || user.email)[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base font-medium flex items-center gap-2 flex-wrap">
                    <span className="truncate">{user.display_name || user.email.split("@")[0]}</span>
                    <Badge
                      variant={user.role === "admin" ? "default" : "secondary"}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {user.role}
                    </Badge>
                    {!user.enabled && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                        disabled
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5 break-words">
                    {user.email} · {user.provider_id} · joined {formatDate(user.created_at, { year: "numeric", month: "short", day: "numeric" })}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs w-full"
                onClick={() => setExpandedUser(expandedUser === user.id ? null : user.id)}
              >
                {expandedUser === user.id ? "▲ Collapse" : "▼ Permissions"}
              </Button>
            </div>
          </CardHeader>

          {/* Quick Controls */}
          <CardContent className="pt-0 pb-3">
            <div className="hidden md:flex items-center gap-6 text-sm">
              {/* Role Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">Role:</span>
                <select
                  value={user.role}
                  onChange={(e) => updateUser(user.id, { role: e.target.value })}
                  disabled={saving === user.id}
                  className="bg-background border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="admin">Admin</option>
                  <option value="user">User</option>
                </select>
              </div>

              {/* Enabled Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">Active:</span>
                <Switch
                  checked={!!user.enabled}
                  onCheckedChange={(checked) => updateUser(user.id, { enabled: checked })}
                  disabled={saving === user.id}
                />
              </div>

              {/* Delete */}
              <div className="ml-auto">
                {deleteConfirm === user.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-400">Delete this user?</span>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 text-xs px-3"
                      onClick={() => handleDeleteUser(user.id)}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setDeleteConfirm(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={() => setDeleteConfirm(user.id)}
                  >
                    🗑 Delete
                  </Button>
                )}
              </div>
            </div>

            <div className="md:hidden space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">Role</span>
                <select
                  value={user.role}
                  onChange={(e) => updateUser(user.id, { role: e.target.value })}
                  disabled={saving === user.id}
                  className="bg-background border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="admin">Admin</option>
                  <option value="user">User</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">Active</span>
                <Switch
                  checked={!!user.enabled}
                  onCheckedChange={(checked) => updateUser(user.id, { enabled: checked })}
                  disabled={saving === user.id}
                />
              </div>

              {deleteConfirm === user.id ? (
                <div className="space-y-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5">
                  <span className="text-xs text-red-400">Delete this user?</span>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 text-xs px-3 flex-1"
                      onClick={() => handleDeleteUser(user.id)}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={() => setDeleteConfirm(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  onClick={() => setDeleteConfirm(user.id)}
                >
                  🗑 Delete
                </Button>
              )}
            </div>
          </CardContent>

          {/* Expanded Permissions */}
          {expandedUser === user.id && (
            <CardContent className="pt-0 border-t border-border/50">
              <div className="pt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                {PERM_LABELS.map(({ key, label, description }) => (
                  <div
                    key={key}
                    className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/50"
                  >
                    <Switch
                      checked={!!user.permissions[key]}
                      onCheckedChange={() => togglePermission(user, key)}
                      disabled={saving === user.id}
                    />
                    <div>
                      <p className="text-xs font-medium">{label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      ))}

      {users.length === 0 && (
        <div className="text-center text-muted-foreground py-12 text-sm">
          No users found.
        </div>
      )}
      {toastSnackbar}
    </div>
  );
}
