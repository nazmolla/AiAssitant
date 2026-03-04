"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Badge from "@mui/material/Badge";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActions from "@mui/material/CardActions";
import Divider from "@mui/material/Divider";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import NotificationsIcon from "@mui/icons-material/Notifications";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import InfoIcon from "@mui/icons-material/Info";
import WarningIcon from "@mui/icons-material/Warning";
import BuildIcon from "@mui/icons-material/Build";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import { useTheme } from "@/components/theme-provider";

interface ApprovalRequest {
  id: string;
  thread_id: string | null;
  tool_name: string;
  args: string;
  reasoning: string | null;
  status: string;
  created_at: string;
}

interface NotificationItem {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: string | null;
  read: number;
  created_at: string;
}

function typeIcon(type: string) {
  switch (type) {
    case "approval_required": return <CheckCircleIcon fontSize="small" color="warning" />;
    case "tool_error": return <ErrorIcon fontSize="small" color="error" />;
    case "proactive_action": return <BuildIcon fontSize="small" color="info" />;
    case "channel_error": return <WarningIcon fontSize="small" color="warning" />;
    case "system_error": return <ErrorIcon fontSize="small" color="error" />;
    default: return <InfoIcon fontSize="small" color="info" />;
  }
}

function typeColor(type: string): "error" | "warning" | "info" | "success" | "default" {
  switch (type) {
    case "tool_error":
    case "system_error": return "error";
    case "approval_required":
    case "channel_error": return "warning";
    case "proactive_action": return "info";
    default: return "default";
  }
}

export function NotificationBell() {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [tab, setTab] = useState(0);
  const [acting, setActing] = useState<Set<string>>(new Set());
  const { formatDate } = useTheme();

  const fetchNotifications = useCallback(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => {
        if (d.notifications) setNotifications(d.notifications);
        if (d.approvals) setApprovals(d.approvals);
        if (typeof d.unreadCount === "number") setUnreadCount(d.unreadCount);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const open = Boolean(anchorEl);

  const handleOpen = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
  }, []);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "markAllRead" }),
    });
    fetchNotifications();
  }, [fetchNotifications]);

  const handleDismiss = useCallback(async (id: string) => {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss", notificationId: id }),
    });
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkRead = useCallback(async (id: string) => {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "markRead", notificationId: id }),
    });
    fetchNotifications();
  }, [fetchNotifications]);

  // ── Approval actions (same as old ApprovalInbox) ──

  async function handleApprovalAction(approvalId: string, action: "approved" | "rejected") {
    setActing((prev) => new Set(prev).add(approvalId));
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || `Failed to ${action === "approved" ? "approve" : "deny"} (HTTP ${res.status})`);
        return;
      }
      fetchNotifications();
      if (action === "approved") {
        window.dispatchEvent(new CustomEvent("approval-resolved", { detail: data }));
      }
    } catch (err) {
      console.error(err);
      alert(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActing((prev) => {
        const next = new Set(prev);
        next.delete(approvalId);
        return next;
      });
    }
  }

  async function handleBulkApproval(ids: string[], action: "approved" | "rejected") {
    setActing((prev) => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
    try {
      for (const id of ids) {
        try {
          const res = await fetch("/api/approvals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ approvalId: id, action }),
          });
          const data = await res.json();
          if (res.ok && action === "approved") {
            window.dispatchEvent(new CustomEvent("approval-resolved", { detail: data }));
          }
        } catch { /* continue with remaining */ }
      }
      fetchNotifications();
    } finally {
      setActing(new Set());
    }
  }

  const isBusy = acting.size > 0;

  // Separate unread general notifications
  const unreadNotifications = useMemo(() => notifications.filter(n => !n.read), [notifications]);
  const readNotifications = useMemo(() => notifications.filter(n => n.read), [notifications]);

  return (
    <>
      <IconButton
        size="small"
        onClick={handleOpen}
        title="Notifications"
        sx={{ color: "text.secondary" }}
      >
        <Badge
          badgeContent={unreadCount}
          color="error"
          max={99}
          sx={{ "& .MuiBadge-badge": { fontSize: "0.65rem", minWidth: 16, height: 16 } }}
        >
          <NotificationsIcon fontSize="small" />
        </Badge>
      </IconButton>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              width: { xs: "100vw", sm: 420 },
              maxHeight: "70vh",
              mt: 1,
              bgcolor: "background.paper",
              backgroundImage: "none",
            },
          },
        }}
      >
        {/* Header */}
        <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="subtitle1" fontWeight={700}>Notifications</Typography>
          {(unreadNotifications.length > 0) && (
            <Button size="small" startIcon={<DoneAllIcon />} onClick={handleMarkAllRead} sx={{ textTransform: "none", fontSize: "0.75rem" }}>
              Mark all read
            </Button>
          )}
        </Box>

        {/* Tabs */}
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="fullWidth"
          sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, fontSize: "0.75rem", textTransform: "none" } }}
        >
          <Tab label={`All${unreadCount ? ` (${unreadCount})` : ""}`} />
          <Tab label={`Approvals${approvals.length ? ` (${approvals.length})` : ""}`} />
        </Tabs>

        <Box sx={{ overflow: "auto", maxHeight: "calc(70vh - 100px)" }}>
          {/* ── Tab 0: All Notifications ── */}
          {tab === 0 && (
            <Box>
              {/* Approvals shown inline as notification cards */}
              {approvals.map((a) => (
                <ApprovalCard key={`approval-${a.id}`} approval={a} acting={acting} isBusy={isBusy} onAction={handleApprovalAction} formatDate={formatDate} />
              ))}
              {unreadNotifications.map((n) => (
                <NotificationCard key={n.id} notification={n} onMarkRead={handleMarkRead} onDismiss={handleDismiss} formatDate={formatDate} />
              ))}
              {readNotifications.length > 0 && unreadNotifications.length > 0 && (
                <Divider sx={{ my: 0.5 }}>
                  <Chip label="Earlier" size="small" sx={{ fontSize: "0.65rem" }} />
                </Divider>
              )}
              {readNotifications.slice(0, 20).map((n) => (
                <NotificationCard key={n.id} notification={n} onMarkRead={handleMarkRead} onDismiss={handleDismiss} formatDate={formatDate} />
              ))}
              {approvals.length === 0 && notifications.length === 0 && (
                <Box sx={{ py: 6, textAlign: "center" }}>
                  <Typography sx={{ fontSize: "1.5rem", mb: 0.5, opacity: 0.3 }}>🔔</Typography>
                  <Typography variant="body2" color="text.secondary">No notifications</Typography>
                </Box>
              )}
            </Box>
          )}

          {/* ── Tab 1: Approvals Only ── */}
          {tab === 1 && (
            <Box>
              {approvals.length > 1 && (
                <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", px: 2, py: 1 }}>
                  <Button
                    size="small" variant="contained" disabled={isBusy}
                    onClick={() => handleBulkApproval(approvals.map(a => a.id), "approved")}
                  >
                    {isBusy ? "Processing..." : `Approve All (${approvals.length})`}
                  </Button>
                  <Button
                    size="small" variant="outlined" disabled={isBusy}
                    onClick={() => handleBulkApproval(approvals.map(a => a.id), "rejected")}
                  >
                    Deny All
                  </Button>
                </Box>
              )}
              {approvals.map((a) => (
                <ApprovalCard key={`approval-tab-${a.id}`} approval={a} acting={acting} isBusy={isBusy} onAction={handleApprovalAction} formatDate={formatDate} />
              ))}
              {approvals.length === 0 && (
                <Box sx={{ py: 6, textAlign: "center" }}>
                  <Typography sx={{ fontSize: "1.5rem", mb: 0.5, opacity: 0.3 }}>✅</Typography>
                  <Typography variant="body2" color="text.secondary">No pending approvals</Typography>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Popover>
    </>
  );
}

/* ── Sub-components ── */

function NotificationCard({
  notification: n,
  onMarkRead,
  onDismiss,
  formatDate,
}: {
  notification: NotificationItem;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  formatDate: (d: string) => string;
}) {
  return (
    <Box
      sx={{
        px: 2, py: 1.5,
        display: "flex", gap: 1.5, alignItems: "flex-start",
        borderBottom: 1, borderColor: "divider",
        bgcolor: n.read ? "transparent" : "action.hover",
        cursor: n.read ? "default" : "pointer",
        "&:hover": { bgcolor: "action.selected" },
        transition: "background-color 0.2s",
      }}
      onClick={() => !n.read && onMarkRead(n.id)}
    >
      <Box sx={{ mt: 0.25 }}>{typeIcon(n.type)}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.25 }}>
          <Typography variant="body2" fontWeight={n.read ? 400 : 600} noWrap sx={{ flex: 1 }}>
            {n.title}
          </Typography>
          <Chip label={n.type.replace(/_/g, " ")} size="small" color={typeColor(n.type)} sx={{ fontSize: "0.6rem", height: 18 }} />
        </Box>
        {n.body && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.3, mb: 0.25 }}>
            {n.body.length > 120 ? n.body.slice(0, 120) + "..." : n.body}
          </Typography>
        )}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 0.25 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
            {formatDate(n.created_at)}
          </Typography>
          <Button
            size="small"
            onClick={(e) => { e.stopPropagation(); onDismiss(n.id); }}
            sx={{ minWidth: 0, fontSize: "0.65rem", textTransform: "none", color: "text.secondary", px: 0.5 }}
          >
            Dismiss
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

function ApprovalCard({
  approval,
  acting,
  isBusy,
  onAction,
  formatDate,
}: {
  approval: ApprovalRequest;
  acting: Set<string>;
  isBusy: boolean;
  onAction: (id: string, action: "approved" | "rejected") => void;
  formatDate: (d: string) => string;
}) {
  let parsedArgs: Record<string, unknown> = {};
  try { parsedArgs = JSON.parse(approval.args); } catch { /* empty */ }

  return (
    <Card variant="outlined" sx={{ mx: 1.5, my: 1, "&:hover": { borderColor: "primary.main" }, transition: "all 0.2s" }}>
      <CardContent sx={{ pb: 0.5, "&:last-child": { pb: 0.5 } }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <CheckCircleIcon fontSize="small" color="warning" />
            <Typography variant="body2" fontWeight={600}>{approval.tool_name}</Typography>
            {!approval.thread_id && (
              <Chip label="Proactive" size="small" color="info" variant="outlined" sx={{ fontSize: "0.6rem", height: 18 }} />
            )}
          </Box>
          <Chip label="Pending" size="small" color="warning" sx={{ fontSize: "0.6rem", height: 18 }} />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
          {formatDate(approval.created_at)}
        </Typography>
        {approval.reasoning && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, lineHeight: 1.3 }}>
            {approval.reasoning.length > 100 ? approval.reasoning.slice(0, 100) + "..." : approval.reasoning}
          </Typography>
        )}
      </CardContent>
      <CardActions sx={{ gap: 0.5, px: 1.5, pb: 1, pt: 0.25 }}>
        <Button
          variant="contained" size="small"
          disabled={acting.has(approval.id) || isBusy}
          onClick={() => onAction(approval.id, "approved")}
          sx={{ fontSize: "0.7rem", py: 0.25 }}
        >
          {acting.has(approval.id) ? "..." : "Approve"}
        </Button>
        <Button
          variant="outlined" size="small"
          disabled={acting.has(approval.id) || isBusy}
          onClick={() => onAction(approval.id, "rejected")}
          sx={{ fontSize: "0.7rem", py: 0.25 }}
        >
          Deny
        </Button>
      </CardActions>
    </Card>
  );
}
