"use client";

import { useState, useEffect } from "react";
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

export function ApprovalInbox() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const { formatDate } = useTheme();

  const fetchApprovals = () => {
    fetch("/api/approvals")
      .then((r) => r.json())
      .then(setApprovals)
      .catch(console.error);
  };

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleAction(approvalId: string, action: "approved" | "rejected") {
    setActing(approvalId);
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

      // Notify the chat panel to refresh messages (agent loop may have continued)
      if (action === "approved") {
        window.dispatchEvent(new CustomEvent("approval-resolved", { detail: data }));
      }
    } catch (err) {
      console.error(err);
      alert(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActing(null);
    }
  }

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
          {approvals.map((approval) => {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(approval.args);
            } catch {}

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
                    disabled={acting === approval.id}
                    size="sm"
                  >
                    {acting === approval.id ? "Processing..." : "Approve"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleAction(approval.id, "rejected")}
                    disabled={acting === approval.id}
                    size="sm"
                  >
                    Deny
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
