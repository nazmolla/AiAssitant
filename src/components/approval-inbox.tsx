"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-display font-bold gradient-text">Approval Inbox</h2>
          <p className="text-sm text-muted-foreground/60 font-light mt-1">Review and authorize agent actions</p>
        </div>
        <Badge variant={approvals.length > 0 ? "warning" : "success"}>
          {approvals.length} pending
        </Badge>
      </div>

      {/* Global Approve All / Deny All */}
      {approvals.length > 1 && (
        <div className="flex gap-2 justify-end">
          <Button
            size="sm"
            disabled={isBusy}
            onClick={() => handleBulk(approvals.map((a) => a.id), "approved")}
          >
            {isBusy ? "Processing..." : `Approve All (${approvals.length})`}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={() => handleBulk(approvals.map((a) => a.id), "rejected")}
          >
            Deny All ({approvals.length})
          </Button>
        </div>
      )}

      {approvals.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="text-4xl mb-3 opacity-40">✅</div>
            <p className="text-sm text-muted-foreground/60 font-light">
              No pending approvals. All clear.
            </p>
          </CardContent>
        </Card>
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
                <Card key={approval.id} className="hover:border-primary/20 transition-all duration-300">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-display">{approval.tool_name}</CardTitle>
                      <Badge variant="warning">Pending</Badge>
                    </div>
                    <CardDescription className="text-muted-foreground/50">
                      {formatDate(approval.created_at)}
                    </CardDescription>
                  </CardHeader>
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
                  <CardFooter className="gap-2">
                    <Button
                      onClick={() => handleAction(approval.id, "approved")}
                      disabled={acting.has(approval.id)}
                      size="sm"
                    >
                      {acting.has(approval.id) ? "Processing..." : "Approve"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleAction(approval.id, "rejected")}
                      disabled={acting.has(approval.id)}
                      size="sm"
                    >
                      Deny
                    </Button>
                  </CardFooter>
                </Card>
              );
            }

            // Multiple items with the same tool name — grouped card
            return (
              <Card key={group.tool_name} className="hover:border-primary/20 transition-all duration-300">
                <CardHeader
                  className="cursor-pointer select-none"
                  onClick={() => toggleExpanded(group.tool_name)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground/40 text-sm">{isExpanded ? "▼" : "▶"}</span>
                      <CardTitle className="text-base font-display">{group.tool_name}</CardTitle>
                    </div>
                    <Badge variant="warning">{count} pending</Badge>
                  </div>
                  <CardDescription className="text-muted-foreground/50">
                    {formatDate(group.items[0].created_at)}
                    {count > 1 && ` — ${formatDate(group.items[count - 1].created_at)}`}
                  </CardDescription>
                </CardHeader>

                {/* Group-level bulk actions */}
                <CardContent className="pt-0 pb-3">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={isBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBulk(group.items.map((a) => a.id), "approved");
                      }}
                    >
                      {isBusy ? "Processing..." : `Approve All ${count}`}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBulk(group.items.map((a) => a.id), "rejected");
                      }}
                    >
                      Deny All {count}
                    </Button>
                  </div>
                </CardContent>

                {/* Expanded individual items */}
                {isExpanded && (
                  <CardContent className="pt-0 space-y-3">
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
                          <div className="flex gap-2 pt-1">
                            <Button
                              onClick={() => handleAction(approval.id, "approved")}
                              disabled={acting.has(approval.id)}
                              size="sm"
                            >
                              {acting.has(approval.id) ? "Processing..." : "Approve"}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => handleAction(approval.id, "rejected")}
                              disabled={acting.has(approval.id)}
                              size="sm"
                            >
                              Deny
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
