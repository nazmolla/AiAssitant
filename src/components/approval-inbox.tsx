"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
      await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, action }),
      });
      fetchApprovals();
    } catch (err) {
      console.error(err);
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Approval Inbox</h2>
        <Badge variant={approvals.length > 0 ? "warning" : "success"}>
          {approvals.length} pending
        </Badge>
      </div>

      {approvals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No pending approvals. All clear.
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
              <Card key={approval.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{approval.tool_name}</CardTitle>
                    <Badge variant="warning">Pending</Badge>
                  </div>
                  <CardDescription>
                    {new Date(approval.created_at).toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {approval.reasoning && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        Agent&apos;s Reasoning
                      </div>
                      <p className="text-sm">{approval.reasoning}</p>
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Arguments
                    </div>
                    <pre className="text-xs bg-muted p-2 rounded-md overflow-auto">
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
                    Approve
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
