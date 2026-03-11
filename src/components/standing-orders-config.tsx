"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import DeleteIcon from "@mui/icons-material/Delete";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ApprovalPreference {
  id: string;
  user_id: string;
  tool_name: string;
  request_key: string;
  device_key: string;
  reason_key: string;
  decision: "approved" | "rejected" | "ignored";
  created_at: string;
  updated_at: string;
}

const DECISION_COLORS: Record<string, "success" | "error" | "warning"> = {
  approved: "success",
  rejected: "error",
  ignored: "warning",
};

const DECISION_LABELS: Record<string, string> = {
  approved: "Always Allow",
  rejected: "Always Reject",
  ignored: "Always Ignore",
};

function formatKey(key: string): string {
  if (!key || key === "*") return "Any";
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function StandingOrdersConfig() {
  const [orders, setOrders] = useState<ApprovalPreference[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDecision, setEditDecision] = useState<string>("");
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const fetchOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/config/standing-orders");
      if (res.ok) {
        setOrders(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const filtered = useMemo(() => {
    let list = orders;
    if (decisionFilter !== "all") {
      list = list.filter((o) => o.decision === decisionFilter);
    }
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter(
        (o) =>
          o.tool_name.toLowerCase().includes(q) ||
          o.request_key.toLowerCase().includes(q) ||
          o.device_key.toLowerCase().includes(q) ||
          o.reason_key.toLowerCase().includes(q)
      );
    }
    return list;
  }, [orders, filter, decisionFilter]);

  const stats = useMemo(() => {
    const allowed = orders.filter((o) => o.decision === "approved").length;
    const rejected = orders.filter((o) => o.decision === "rejected").length;
    const ignored = orders.filter((o) => o.decision === "ignored").length;
    return { total: orders.length, allowed, rejected, ignored };
  }, [orders]);

  async function handleUpdateDecision(id: string, decision: string) {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch("/api/config/standing-orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      if (res.ok) {
        setOrders((prev) =>
          prev.map((o) => (o.id === id ? { ...o, decision: decision as ApprovalPreference["decision"], updated_at: new Date().toISOString() } : o))
        );
      }
    } finally {
      setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      setEditingId(null);
    }
  }

  async function handleDelete(id: string) {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/config/standing-orders?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        setOrders((prev) => prev.filter((o) => o.id !== id));
      }
    } finally {
      setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  async function handleDeleteAll() {
    setConfirmDeleteAll(false);
    setIsLoading(true);
    try {
      const res = await fetch("/api/config/standing-orders", { method: "DELETE" });
      if (res.ok) setOrders([]);
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground/70">
          Loading standing orders...
        </CardContent>
      </Card>
    );
  }

  if (orders.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="text-3xl mb-3 opacity-30">📋</div>
          <p className="text-sm text-muted-foreground/60 font-light">
            No standing orders yet. They are created when you choose &quot;Always Allow&quot;, &quot;Always Ignore&quot;, or &quot;Always Reject&quot; on an approval request.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card>
        <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
        <CardContent>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center" }}>
            <Chip label={`${stats.total} total`} size="small" variant="outlined" />
            <Chip label={`${stats.allowed} allowed`} size="small" color="success" variant="outlined" />
            <Chip label={`${stats.rejected} rejected`} size="small" color="error" variant="outlined" />
            <Chip label={`${stats.ignored} ignored`} size="small" color="warning" variant="outlined" />
            <Box sx={{ flex: 1 }} />
            <Button
              size="small"
              color="error"
              variant="outlined"
              onClick={() => setConfirmDeleteAll(true)}
              sx={{ textTransform: "none", fontSize: "0.75rem" }}
            >
              Clear All Standing Orders
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Filters */}
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          size="small"
          placeholder="Filter by tool, action, device..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          sx={{ minWidth: 240, flex: 1 }}
        />
        <Select
          size="small"
          value={decisionFilter}
          onChange={(e) => setDecisionFilter(e.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="all">All decisions</MenuItem>
          <MenuItem value="approved">Always Allow</MenuItem>
          <MenuItem value="rejected">Always Reject</MenuItem>
          <MenuItem value="ignored">Always Ignore</MenuItem>
        </Select>
      </Box>

      {/* Standing orders list */}
      <Card>
        <CardHeader>
          <CardTitle>
            Standing Orders ({filtered.length}{filtered.length !== orders.length ? ` of ${orders.length}` : ""})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
              No matches for the current filter.
            </Typography>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {filtered.map((order) => {
                const busy = busyIds.has(order.id);
                const isEditing = editingId === order.id;

                return (
                  <Box
                    key={order.id}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      p: 1.5,
                      borderRadius: 1,
                      border: 1,
                      borderColor: "divider",
                      bgcolor: "background.paper",
                      opacity: busy ? 0.5 : 1,
                      flexWrap: { xs: "wrap", sm: "nowrap" },
                    }}
                  >
                    {/* Decision chip */}
                    {isEditing ? (
                      <Select
                        size="small"
                        value={editDecision}
                        onChange={(e) => setEditDecision(e.target.value)}
                        sx={{ minWidth: 130, fontSize: "0.8rem" }}
                      >
                        <MenuItem value="approved">Always Allow</MenuItem>
                        <MenuItem value="rejected">Always Reject</MenuItem>
                        <MenuItem value="ignored">Always Ignore</MenuItem>
                      </Select>
                    ) : (
                      <Tooltip title="Click to change decision">
                        <Chip
                          label={DECISION_LABELS[order.decision] || order.decision}
                          size="small"
                          color={DECISION_COLORS[order.decision] || "default"}
                          onClick={() => { setEditingId(order.id); setEditDecision(order.decision); }}
                          sx={{ cursor: "pointer", fontWeight: 600, minWidth: 110 }}
                        />
                      </Tooltip>
                    )}

                    {/* Details */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {order.tool_name}
                      </Typography>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.25 }}>
                        <Typography variant="caption" color="text.secondary">
                          Action: <strong>{formatKey(order.request_key)}</strong>
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          &middot; Device: <strong>{formatKey(order.device_key)}</strong>
                        </Typography>
                        {order.reason_key !== "*" && (
                          <Typography variant="caption" color="text.secondary">
                            &middot; Reason: <strong>{formatKey(order.reason_key)}</strong>
                          </Typography>
                        )}
                      </Box>
                    </Box>

                    {/* Timestamp */}
                    <Tooltip title={`Created: ${order.created_at}\nUpdated: ${order.updated_at}`}>
                      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                        {timeAgo(order.updated_at)}
                      </Typography>
                    </Tooltip>

                    {/* Actions */}
                    {isEditing ? (
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Button
                          size="small"
                          variant="contained"
                          disabled={busy || editDecision === order.decision}
                          onClick={() => handleUpdateDecision(order.id, editDecision)}
                          sx={{ textTransform: "none", fontSize: "0.75rem" }}
                        >
                          Save
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => setEditingId(null)}
                          sx={{ textTransform: "none", fontSize: "0.75rem" }}
                        >
                          Cancel
                        </Button>
                      </Box>
                    ) : (
                      <Tooltip title="Delete this standing order">
                        <IconButton size="small" onClick={() => handleDelete(order.id)} disabled={busy}>
                          {busy ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                );
              })}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Confirm delete all dialog */}
      <Dialog open={confirmDeleteAll} onClose={() => setConfirmDeleteAll(false)} fullWidth maxWidth="lg">
        <DialogTitle>Clear All Standing Orders?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This will delete all {orders.length} standing order{orders.length !== 1 ? "s" : ""}. Future tool
            calls will require manual approval again until new standing orders are created.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteAll(false)}>Cancel</Button>
          <Button onClick={handleDeleteAll} color="error" variant="contained">
            Delete All
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
