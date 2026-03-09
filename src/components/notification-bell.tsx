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
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import NotificationsIcon from "@mui/icons-material/Notifications";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import InfoIcon from "@mui/icons-material/Info";
import WarningIcon from "@mui/icons-material/Warning";
import BuildIcon from "@mui/icons-material/Build";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseIcon from "@mui/icons-material/Close";
import { useTheme } from "@/components/theme-provider";

interface ApprovalRequest {
  id: string;
  thread_id: string | null;
  tool_name: string;
  args: string;
  reasoning: string | null;
  nl_request: string | null;
  source: string;
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

interface ApprovalGroup {
  key: string;
  toolName: string;
  approvals: ApprovalRequest[];
}

function parseArgs(argsRaw: string): Record<string, unknown> {
  try {
    return JSON.parse(argsRaw);
  } catch {
    return {};
  }
}

function toTitleCase(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Map common Home Assistant / MCP tool names to readable action verbs */
const TOOL_ACTION_MAP: Record<string, string> = {
  hassturnon: "Turn On",
  hassturnoff: "Turn Off",
  hasstoggle: "Toggle",
  hasssetvalue: "Set Value",
  hassgetstate: "Get State",
  hasscallservice: "Call Service",
  hasssetbrightness: "Set Brightness",
  hasssettemperature: "Set Temperature",
  hasslock: "Lock",
  hassunlock: "Unlock",
  hassopen: "Open",
  hassclose: "Close",
  hassarm: "Arm",
  hassdisarm: "Disarm",
  hassactivatescene: "Activate Scene",
  hassplayermediaplay: "Play Media",
  hassplayermediastop: "Stop Media",
  hassplayermediapause: "Pause Media",
};

function readableAction(toolName: string, args: Record<string, unknown>): string {
  // Check explicit args for action/intent first
  for (const key of ["intent", "action", "service", "command", "mode"]) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return toTitleCase(v.trim());
  }
  // Strip prefix (e.g. "mcp_hass_server." or "builtin.")
  const parts = toolName.split(".");
  const shortName = parts[parts.length - 1] || toolName;
  // Check Hass tool map
  const mapped = TOOL_ACTION_MAP[shortName.toLowerCase()];
  if (mapped) return mapped;
  // UUID-based MCP tool — look for action in args
  if (/^[0-9a-f]{8}-/i.test(shortName)) {
    const fallback = (args.action as string) || (args.service as string) || "Tool Action";
    return toTitleCase(fallback);
  }
  return toTitleCase(shortName);
}

/** Extract a human-readable device/entity name from tool arguments */
function readableTarget(args: Record<string, unknown>): string | null {
  // Try explicit name fields first
  for (const key of ["name", "deviceName", "entityName", "device", "light", "target"]) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return toTitleCase(v.trim());
  }
  // Fall back to entity_id: "light.lounge_light" → "Lounge Light"
  const entityId = args.entity_id;
  if (typeof entityId === "string" && entityId.includes(".")) {
    const name = entityId.split(".").slice(1).join(".");
    return toTitleCase(name);
  }
  // Try plain id
  const id = args.id;
  if (typeof id === "string" && id.trim() && !/^[0-9a-f-]{36}$/i.test(id)) {
    return toTitleCase(id);
  }
  return null;
}

function readableLocation(args: Record<string, unknown>): string | null {
  for (const key of ["area", "room", "zone", "group"]) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

const SOURCE_LABELS: Record<string, string> = {
  proactive: "Proactive Agent",
  email: "Email",
  voice: "Voice",
};

function readableSource(approval: ApprovalRequest): string {
  const src = (approval.source || "").trim();
  if (src.startsWith("email:")) {
    const sender = src.slice("email:".length).trim();
    return sender ? `Email (${sender})` : "Email";
  }
  if (src.startsWith("proactive:")) {
    const subtype = src.slice("proactive:".length).trim();
    return subtype ? `Proactive Agent (${toTitleCase(subtype)})` : "Proactive Agent";
  }
  return SOURCE_LABELS[src] || toTitleCase(src || "proactive");
}

interface ApprovalDetails {
  action: string;
  target: string | null;
  location: string | null;
  reason: string | null;
  source: string;
}

function buildApprovalDetails(approval: ApprovalRequest): ApprovalDetails {
  const args = parseArgs(approval.args);
  const reason = approval.reasoning?.trim() || approval.nl_request?.trim() || null;
  return {
    action: readableAction(approval.tool_name, args),
    target: readableTarget(args),
    location: readableLocation(args),
    reason,
    source: readableSource(approval),
  };
}

/** Legacy single-line description (used for group header summary) */
function buildApprovalDescription(approval: ApprovalRequest): string {
  const d = buildApprovalDetails(approval);
  const segments: string[] = [d.action];
  if (d.target) segments.push(`"${d.target}"`);
  if (d.location) segments.push(`in ${d.location}`);
  return segments.join(" ");
}

function groupApprovals(items: ApprovalRequest[]): ApprovalGroup[] {
  const map = new Map<string, ApprovalGroup>();
  for (const item of items) {
    const args = parseArgs(item.args);
    const argsKey = JSON.stringify(args);
    const reasoningKey = (item.reasoning || "").trim();
    const key = `${item.tool_name}::${argsKey}::${reasoningKey}`;
    const existing = map.get(key);
    if (existing) {
      existing.approvals.push(item);
      continue;
    }
    map.set(key, {
      key,
      toolName: item.tool_name,
      approvals: [item],
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    const aTime = new Date(a.approvals[0].created_at).getTime();
    const bTime = new Date(b.approvals[0].created_at).getTime();
    return bTime - aTime;
  });
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
  const [expandedOpen, setExpandedOpen] = useState(false);
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

  async function handleApprovalAction(approvalId: string, action: "approved" | "rejected" | "ignored", rememberDecision?: "approved" | "rejected" | "ignored") {
    setActing((prev) => new Set(prev).add(approvalId));
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, action, rememberDecision }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || `Failed to ${action === "approved" ? "approve" : action} (HTTP ${res.status})`);
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
  const groupedApprovals = useMemo(() => groupApprovals(approvals), [approvals]);

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
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Button size="small" startIcon={<OpenInFullIcon />} onClick={() => setExpandedOpen(true)} sx={{ textTransform: "none", fontSize: "0.75rem" }}>
              Open Full View
            </Button>
            {(unreadNotifications.length > 0) && (
              <Button size="small" startIcon={<DoneAllIcon />} onClick={handleMarkAllRead} sx={{ textTransform: "none", fontSize: "0.75rem" }}>
                Mark all read
              </Button>
            )}
          </Box>
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
              {approvals.length > 0 && (
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
                    Reject All ({approvals.length})
                  </Button>
                </Box>
              )}
              {groupedApprovals.map((g) => (
                <ApprovalGroupCard
                  key={`approval-group-${g.key}`}
                  group={g}
                  acting={acting}
                  isBusy={isBusy}
                  onAction={handleApprovalAction}
                  onBulkAction={handleBulkApproval}
                  formatDate={formatDate}
                />
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
              {approvals.length > 0 && (
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
                    Reject All ({approvals.length})
                  </Button>
                </Box>
              )}
              {groupedApprovals.map((g) => (
                <ApprovalGroupCard
                  key={`approval-tab-${g.key}`}
                  group={g}
                  acting={acting}
                  isBusy={isBusy}
                  onAction={handleApprovalAction}
                  onBulkAction={handleBulkApproval}
                  formatDate={formatDate}
                />
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

      <Dialog
        open={expandedOpen}
        onClose={() => setExpandedOpen(false)}
        fullScreen
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography variant="h6" fontWeight={700}>Approval Center</Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {approvals.length > 0 && (
              <>
                <Button
                  size="small"
                  variant="contained"
                  disabled={isBusy}
                  onClick={() => handleBulkApproval(approvals.map((a) => a.id), "approved")}
                >
                  {isBusy ? "Processing..." : `Approve All (${approvals.length})`}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={isBusy}
                  onClick={() => handleBulkApproval(approvals.map((a) => a.id), "rejected")}
                >
                  Reject All ({approvals.length})
                </Button>
              </>
            )}
            <IconButton onClick={() => setExpandedOpen(false)} size="small" title="Close full view">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Grouped by tool and request payload. Expand groups to review details, rationale, and execute bulk or per-item decisions.
          </Typography>
          <Box>
            {groupedApprovals.map((g) => (
              <ApprovalGroupCard
                key={`approval-full-${g.key}`}
                group={g}
                acting={acting}
                isBusy={isBusy}
                onAction={handleApprovalAction}
                onBulkAction={handleBulkApproval}
                formatDate={formatDate}
                dense={false}
              />
            ))}
            {groupedApprovals.length === 0 && (
              <Box sx={{ py: 8, textAlign: "center" }}>
                <Typography sx={{ fontSize: "1.5rem", mb: 0.5, opacity: 0.3 }}>✅</Typography>
                <Typography variant="body1" color="text.secondary">No pending approvals</Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
      </Dialog>
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

function ApprovalGroupCard({
  group,
  acting,
  isBusy,
  onAction,
  onBulkAction,
  formatDate,
  dense = true,
}: {
  group: ApprovalGroup;
  acting: Set<string>;
  isBusy: boolean;
  onAction: (id: string, action: "approved" | "rejected" | "ignored", rememberDecision?: "approved" | "rejected" | "ignored") => void;
  onBulkAction: (ids: string[], action: "approved" | "rejected") => void;
  formatDate: (d: string) => string;
  dense?: boolean;
}) {
  const first = group.approvals[0];
  const firstDetails = buildApprovalDetails(first);
  const ids = group.approvals.map((a) => a.id);

  return (
    <Card variant="outlined" sx={{ mx: dense ? 1.5 : 0, my: 1, borderColor: "divider" }}>
      <CardContent sx={{ pb: 1, "&:last-child": { pb: 1 } }}>
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
            <BuildIcon fontSize="small" color="info" />
            <Typography variant="body2" fontWeight={700}>{firstDetails.action}</Typography>
            {firstDetails.target && (
              <Chip label={firstDetails.target} size="small" color="info" variant="outlined" sx={{ fontSize: "0.65rem", height: 20 }} />
            )}
            <Chip label={`${group.approvals.length} request${group.approvals.length > 1 ? "s" : ""}`} size="small" color="warning" sx={{ fontSize: "0.65rem", height: 20 }} />
          </Box>
          <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
            <Button size="small" variant="contained" disabled={isBusy} onClick={() => onBulkAction(ids, "approved")}>Approve Group</Button>
            <Button size="small" variant="outlined" disabled={isBusy} onClick={() => onBulkAction(ids, "rejected")}>Reject Group</Button>
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
          {buildApprovalDescription(first)}
        </Typography>
      </CardContent>
      <Divider />
      <Box sx={{ px: 1.5, py: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        {group.approvals.map((approval) => {
          const details = buildApprovalDetails(approval);
          return (
          <Box key={approval.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, px: 1, py: 0.75 }}>
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
              <Typography variant="caption" color="text.secondary">{formatDate(approval.created_at)}</Typography>
              <Box sx={{ display: "flex", gap: 0.75 }}>
                <Button
                  variant="contained"
                  size="small"
                  disabled={acting.has(approval.id) || isBusy}
                  onClick={() => onAction(approval.id, "approved")}
                  sx={{ fontSize: "0.7rem", py: 0.25 }}
                >
                  {acting.has(approval.id) ? "..." : "Approve"}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={acting.has(approval.id) || isBusy}
                  onClick={() => onAction(approval.id, "rejected")}
                  sx={{ fontSize: "0.7rem", py: 0.25 }}
                >
                  Reject
                </Button>
                <Button
                  variant="text"
                  size="small"
                  disabled={acting.has(approval.id) || isBusy}
                  onClick={() => onAction(approval.id, "ignored")}
                  sx={{ fontSize: "0.7rem", py: 0.25 }}
                >
                  Ignore
                </Button>
              </Box>
            </Box>
            {/* Structured approval details */}
            <Box sx={{ mt: 0.75, display: "flex", flexDirection: "column", gap: 0.25 }}>
              <Typography variant="caption" color="text.primary">
                <strong>Action:</strong> {details.action}
              </Typography>
              {details.target && (
                <Typography variant="caption" color="text.primary">
                  <strong>Item:</strong> {details.target}
                </Typography>
              )}
              {details.location && (
                <Typography variant="caption" color="text.primary">
                  <strong>Location:</strong> {details.location}
                </Typography>
              )}
              {details.reason && (
                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                  <strong>Reason:</strong> {details.reason.length > 200 ? details.reason.slice(0, 200) + "..." : details.reason}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                <strong>Source:</strong> {details.source}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 0.5, mt: 0.75, flexWrap: "wrap" }}>
              <Button size="small" variant="text" disabled={acting.has(approval.id) || isBusy} onClick={() => onAction(approval.id, "approved", "approved")}>Always Allow</Button>
              <Button size="small" variant="text" disabled={acting.has(approval.id) || isBusy} onClick={() => onAction(approval.id, "ignored", "ignored")}>Always Ignore</Button>
              <Button size="small" variant="text" disabled={acting.has(approval.id) || isBusy} onClick={() => onAction(approval.id, "rejected", "rejected")}>Always Reject</Button>
            </Box>
          </Box>
          );
        })}
      </Box>
    </Card>
  );
}
