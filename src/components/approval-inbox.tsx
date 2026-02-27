"use client";

import { useState, useEffect, useMemo } from "react";
import Box from "@mui/material/Box";
import MuiButton from "@mui/material/Button";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActions from "@mui/material/CardActions";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
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

interface GroupedApproval {
  tool_name: string;
  items: ApprovalRequest[];
}

export function ApprovalInbox() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [acting, setActing] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { formatDate } = useTheme();

  const fetchApprovals = () => {
    fetch("/api/approvals")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setApprovals(d); })
      .catch(console.error);
  };

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 15000);
    return () => clearInterval(interval);
  }, []);

  // Group approvals by tool_name
  const grouped = useMemo<GroupedApproval[]>(() => {
    const map = new Map<string, ApprovalRequest[]>();
    for (const a of approvals) {
      const existing = map.get(a.tool_name);
      if (existing) existing.push(a);
      else map.set(a.tool_name, [a]);
    }
    return Array.from(map.entries()).map(([tool_name, items]) => ({ tool_name, items }));
  }, [approvals]);

  const toggleExpanded = (toolName: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) next.delete(toolName);
      else next.add(toolName);
      return next;
    });

  async function handleAction(approvalId: string, action: "approved" | "rejected") {
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

      fetchApprovals();

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

  async function handleBulk(ids: string[], action: "approved" | "rejected") {
    setActing((prev) => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
    try {
      // Process sequentially to avoid race conditions with agent loop continuations
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
      fetchApprovals();
    } finally {
      setActing(new Set());
    }
  }

  const isBusy = acting.size > 0;

  return (
    <div className="space-y-6">
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <Typography variant="h5" sx={{ fontWeight: 700, color: "primary.main" }}>Approval Inbox</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Review and authorize agent actions</Typography>
        </div>
        <Chip
          label={`${approvals.length} pending`}
          size="small"
          color={approvals.length > 0 ? "warning" : "success"}
        />
      </Box>

      {/* Global Approve All / Deny All */}
      {approvals.length > 1 && (
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <MuiButton
            size="small"
            variant="contained"
            disabled={isBusy}
            onClick={() => handleBulk(approvals.map((a) => a.id), "approved")}
          >
            {isBusy ? "Processing..." : `Approve All (${approvals.length})`}
          </MuiButton>
          <MuiButton
            size="small"
            variant="outlined"
            disabled={isBusy}
            onClick={() => handleBulk(approvals.map((a) => a.id), "rejected")}
          >
            Deny All ({approvals.length})
          </MuiButton>
        </Box>
      )}

      {approvals.length === 0 ? (
        <MuiCard variant="outlined">
          <CardContent sx={{ py: 8, textAlign: "center" }}>
            <Typography sx={{ fontSize: "2rem", mb: 1, opacity: 0.4 }}>✅</Typography>
            <Typography variant="body2" color="text.secondary">
              No pending approvals. All clear.
            </Typography>
          </CardContent>
        </MuiCard>
      ) : (
        <div className="grid gap-4">
          {grouped.map((group) => {
            const isExpanded = expanded.has(group.tool_name);
            const count = group.items.length;

            // Single item — render flat (no grouping chrome)
            if (count === 1) {
              const approval = group.items[0];
              let parsedArgs: Record<string, unknown> = {};
              try { parsedArgs = JSON.parse(approval.args); } catch {}

              return (
                <MuiCard key={approval.id} variant="outlined" sx={{ '&:hover': { borderColor: 'primary.main', opacity: 0.8 }, transition: 'all 0.3s' }}>
                  <CardContent sx={{ pb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{approval.tool_name}</Typography>
                      <Chip label="Pending" size="small" color="warning" />
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(approval.created_at)}
                    </Typography>
                  </CardContent>
                  <CardContent className="space-y-3">
                    {approval.reasoning && (
                      <div>
                        <div className="text-[11px] font-medium text-muted-foreground/60 mb-1 uppercase tracking-wider">
                          Agent&apos;s Reasoning
                        </div>
                        <p className="text-sm text-foreground/80">{approval.reasoning}</p>
                      </div>
                    )}
                    <div>
                      <div className="text-[11px] font-medium text-muted-foreground/60 mb-1 uppercase tracking-wider">
                        Arguments
                      </div>
                      <pre className="text-xs bg-white/[0.03] p-3 rounded-xl overflow-auto border border-white/[0.06]">
                        {JSON.stringify(parsedArgs, null, 2)}
                      </pre>
                    </div>
                  </CardContent>
                  <CardActions sx={{ gap: 1, px: 2, pb: 2 }}>
                    <MuiButton
                      variant="contained"
                      onClick={() => handleAction(approval.id, "approved")}
                      disabled={acting.has(approval.id)}
                      size="small"
                    >
                      {acting.has(approval.id) ? "Processing..." : "Approve"}
                    </MuiButton>
                    <MuiButton
                      variant="outlined"
                      onClick={() => handleAction(approval.id, "rejected")}
                      disabled={acting.has(approval.id)}
                      size="small"
                    >
                      Deny
                    </MuiButton>
                  </CardActions>
                </MuiCard>
              );
            }

            // Multiple items with the same tool name — grouped card
            return (
              <MuiCard key={group.tool_name} variant="outlined" sx={{ '&:hover': { borderColor: 'primary.main', opacity: 0.8 }, transition: 'all 0.3s' }}>
                <CardContent
                  sx={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleExpanded(group.tool_name)}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" color="text.secondary">{isExpanded ? "▼" : "▶"}</Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{group.tool_name}</Typography>
                    </Box>
                    <Chip label={`${count} pending`} size="small" color="warning" />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {formatDate(group.items[0].created_at)}
                    {count > 1 && ` — ${formatDate(group.items[count - 1].created_at)}`}
                  </Typography>
                </CardContent>

                <CardContent sx={{ pt: 0, pb: 1 }}>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <MuiButton
                      size="small"
                      variant="contained"
                      disabled={isBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBulk(group.items.map((a) => a.id), "approved");
                      }}
                    >
                      {isBusy ? "Processing..." : `Approve All ${count}`}
                    </MuiButton>
                    <MuiButton
                      size="small"
                      variant="outlined"
                      disabled={isBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBulk(group.items.map((a) => a.id), "rejected");
                      }}
                    >
                      Deny All {count}
                    </MuiButton>
                  </Box>
                </CardContent>

                {isExpanded && (
                  <CardContent sx={{ pt: 0 }} className="space-y-3">
                    {group.items.map((approval, idx) => {
                      let parsedArgs: Record<string, unknown> = {};
                      try { parsedArgs = JSON.parse(approval.args); } catch {}

                      return (
                        <div
                          key={approval.id}
                          className="rounded-xl border border-white/[0.06] p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground/50">
                              #{idx + 1} · {formatDate(approval.created_at)}
                            </span>
                          </div>
                          {approval.reasoning && (
                            <div>
                              <div className="text-[11px] font-medium text-muted-foreground/60 mb-1 uppercase tracking-wider">
                                Agent&apos;s Reasoning
                              </div>
                              <p className="text-sm text-foreground/80">{approval.reasoning}</p>
                            </div>
                          )}
                          <div>
                            <div className="text-[11px] font-medium text-muted-foreground/60 mb-1 uppercase tracking-wider">
                              Arguments
                            </div>
                            <pre className="text-xs bg-white/[0.03] p-3 rounded-xl overflow-auto border border-white/[0.06]">
                              {JSON.stringify(parsedArgs, null, 2)}
                            </pre>
                          </div>
                          <Box sx={{ display: 'flex', gap: 1, pt: 0.5 }}>
                            <MuiButton
                              variant="contained"
                              onClick={() => handleAction(approval.id, "approved")}
                              disabled={acting.has(approval.id)}
                              size="small"
                            >
                              {acting.has(approval.id) ? "Processing..." : "Approve"}
                            </MuiButton>
                            <MuiButton
                              variant="outlined"
                              onClick={() => handleAction(approval.id, "rejected")}
                              disabled={acting.has(approval.id)}
                              size="small"
                            >
                              Deny
                            </MuiButton>
                          </Box>
                        </div>
                      );
                    })}
                  </CardContent>
                )}
              </MuiCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
