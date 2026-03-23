import { getDb, cachedStmt as _cachedStmt } from "./connection";
import { v4 as uuid } from "uuid";
import { buildApprovalPreferenceSignature } from "@/lib/approvals/preference-signature";
import { appCache, CACHE_KEYS } from "@/lib/cache";

/** Thin wrapper that passes the (patchable) `getDb` import to the cache */
function stmt(sql: string) { return _cachedStmt(sql, getDb); }

// ——— Tool Policies ———————————————————————————————————

export interface ToolPolicy {
  tool_name: string;
  mcp_id: string | null;
  requires_approval: number;
  scope: "global" | "user";
}

export function listToolPolicies(): ToolPolicy[] {
  return appCache.get(
    CACHE_KEYS.TOOL_POLICIES,
    () => stmt("SELECT * FROM tool_policies").all() as ToolPolicy[]
  );
}

export function getToolPolicy(toolName: string): ToolPolicy | undefined {
  return stmt("SELECT * FROM tool_policies WHERE tool_name = ?").get(toolName) as ToolPolicy | undefined;
}

export function upsertToolPolicy(policy: ToolPolicy): void {
  getDb()
    .prepare(
      `INSERT INTO tool_policies (tool_name, mcp_id, requires_approval, scope)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tool_name) DO UPDATE SET
         mcp_id = excluded.mcp_id,
         requires_approval = excluded.requires_approval,
         scope = excluded.scope`
    )
    .run(policy.tool_name, policy.mcp_id, policy.requires_approval, policy.scope ?? "global");
  appCache.invalidate(CACHE_KEYS.TOOL_POLICIES);
}

// ——— Approval Queue —————————————————————————————————

export interface ApprovalRequest {
  id: string;
  thread_id: string | null;
  tool_name: string;
  args: string;
  reasoning: string | null;
  nl_request: string | null;
  source: string;
  status: string;
  expires_at: string | null;
  created_at: string;
}

export function createApprovalRequest(
  req: Omit<ApprovalRequest, "id" | "status" | "created_at" | "nl_request" | "source" | "expires_at"> & {
    nl_request?: string | null;
    source?: string;
    expiresAt?: string;
  }
): ApprovalRequest {
  const id = uuid();
  return getDb()
    .prepare(
      `INSERT INTO approval_queue (id, thread_id, tool_name, args, reasoning, nl_request, source, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      id,
      req.thread_id,
      req.tool_name,
      req.args,
      req.reasoning,
      req.nl_request ?? null,
      req.source ?? "chat",
      req.expiresAt ?? null
    ) as ApprovalRequest;
}

export function getApprovalById(id: string): ApprovalRequest | undefined {
  return stmt("SELECT * FROM approval_queue WHERE id = ?").get(id) as ApprovalRequest | undefined;
}

export function listPendingApprovals(): ApprovalRequest[] {
  return stmt(
    "SELECT * FROM approval_queue WHERE status = 'pending' ORDER BY created_at DESC"
  ).all() as ApprovalRequest[];
}

/**
 * Return pending approvals scoped to threads owned by `userId`.
 * Uses a single JOIN — O(1) queries instead of O(n).
 * Proactive approvals (thread_id IS NULL) are excluded for non-admin callers.
 */
export function listPendingApprovalsForUser(userId: string): ApprovalRequest[] {
  return getDb()
    .prepare(
      `SELECT a.* FROM approval_queue a
       JOIN threads t ON a.thread_id = t.id
       WHERE a.status = 'pending' AND t.user_id = ?
       ORDER BY a.created_at DESC`
    )
    .all(userId) as ApprovalRequest[];
}

/**
 * Auto-reject stale pending approvals in bulk:
 * - thread has been deleted (orphaned)
 * - thread status is no longer 'awaiting_approval'
 * Proactive approvals (thread_id IS NULL) are never touched.
 * Returns the count of rejected rows.
 */
export function cleanStaleApprovals(): number {
  const db = getDb();
  // Reject approvals whose thread no longer exists
  const orphaned = db
    .prepare(
      `UPDATE approval_queue SET status = 'rejected'
       WHERE status = 'pending' AND thread_id IS NOT NULL
         AND thread_id NOT IN (SELECT id FROM threads)`
    )
    .run();
  // Reject approvals whose thread is no longer awaiting_approval
  const stale = db
    .prepare(
      `UPDATE approval_queue SET status = 'rejected'
       WHERE status = 'pending' AND thread_id IS NOT NULL
         AND thread_id IN (SELECT id FROM threads WHERE status != 'awaiting_approval')`
    )
    .run();
  return orphaned.changes + stale.changes;
}

export function updateApprovalStatus(id: string, status: "approved" | "rejected"): void {
  getDb().prepare("UPDATE approval_queue SET status = ? WHERE id = ?").run(status, id);
}

export interface ApprovalPreference {
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

export function upsertApprovalPreferenceFromApproval(
  userId: string,
  approval: ApprovalRequest,
  decision: "approved" | "rejected" | "ignored"
): void {
  const signature = buildApprovalPreferenceSignature({
    toolName: approval.tool_name,
    argsRaw: approval.args,
    reasoning: approval.reasoning,
    nlRequest: approval.nl_request,
  });

  getDb().prepare(
    `INSERT INTO approval_preferences (id, user_id, tool_name, request_key, device_key, reason_key, decision)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, tool_name, request_key, device_key, reason_key)
     DO UPDATE SET
       decision = excluded.decision,
       updated_at = CURRENT_TIMESTAMP`
  ).run(
    uuid(),
    userId,
    approval.tool_name,
    signature.request_key,
    signature.device_key,
    signature.reason_key,
    decision
  );
}

export function findApprovalPreferenceDecision(
  userId: string,
  toolName: string,
  argsRaw: string,
  reasoning: string | null,
  nlRequest?: string | null
): "approved" | "rejected" | "ignored" | null {
  const signature = buildApprovalPreferenceSignature({
    toolName,
    argsRaw,
    reasoning,
    nlRequest,
  });

  const row = getDb().prepare(
    `SELECT decision FROM approval_preferences
     WHERE user_id = ?
       AND tool_name = ?
       AND request_key = ?
       AND device_key = ?
       AND reason_key = ?`
  ).get(
    userId,
    toolName,
    signature.request_key,
    signature.device_key,
    signature.reason_key
  ) as { decision: "approved" | "rejected" | "ignored" } | undefined;

  return row?.decision ?? null;
}

export function listApprovalPreferences(userId: string): ApprovalPreference[] {
  return getDb()
    .prepare(
      `SELECT * FROM approval_preferences
       WHERE user_id = ?
       ORDER BY updated_at DESC`
    )
    .all(userId) as ApprovalPreference[];
}

export function updateApprovalPreferenceDecision(
  id: string,
  userId: string,
  decision: "approved" | "rejected" | "ignored"
): boolean {
  const result = getDb()
    .prepare(
      `UPDATE approval_preferences
       SET decision = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    )
    .run(decision, id, userId);
  return result.changes > 0;
}

export function deleteApprovalPreference(id: string, userId: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM approval_preferences WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return result.changes > 0;
}

export function deleteAllApprovalPreferences(userId: string): number {
  const result = getDb()
    .prepare("DELETE FROM approval_preferences WHERE user_id = ?")
    .run(userId);
  return result.changes;
}
