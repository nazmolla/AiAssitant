import { getDb } from "./connection";
import { SCHEMA_SQL } from "./schema";
import { FS_TOOLS_REQUIRING_APPROVAL } from "@/lib/agent/fs-tools";

function ensureIdentityPasswordColumn(): void {
  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(identity_config)").all() as { name: string }[];
  const hasPasswordColumn = columns.some((col) => col.name === "password_hash");
  if (!hasPasswordColumn) {
    db.prepare("ALTER TABLE identity_config ADD COLUMN password_hash TEXT").run();
  }
}

function ensureLlmProviderPurposeColumn(): void {
  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(llm_providers)").all() as { name: string }[];
  const hasPurpose = columns.some((col) => col.name === "purpose");
  if (!hasPurpose) {
    db.prepare("ALTER TABLE llm_providers ADD COLUMN purpose TEXT NOT NULL DEFAULT 'chat'").run();
  }
}

function ensureMessageAttachmentsColumn(): void {
  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const hasAttachments = columns.some((col) => col.name === "attachments");
  if (!hasAttachments) {
    db.prepare("ALTER TABLE messages ADD COLUMN attachments TEXT").run();
  }
}

/**
 * Seed approval-required policies for destructive filesystem tools.
 * Only inserts if the policy doesn't already exist (won't override user changes).
 */
function seedFsToolPolicies(): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO tool_policies (tool_name, mcp_id, requires_approval, is_proactive_enabled)
     VALUES (?, NULL, 1, 0)`
  );
  for (const toolName of FS_TOOLS_REQUIRING_APPROVAL) {
    stmt.run(toolName);
  }
}

export function initializeDatabase(): void {
  const db = getDb();
  db.exec(SCHEMA_SQL);
  ensureIdentityPasswordColumn();
  ensureLlmProviderPurposeColumn();
  ensureMessageAttachmentsColumn();
  seedFsToolPolicies();
  console.log("[Nexus DB] Schema initialized successfully.");
}

// Run directly with `tsx src/lib/db/init.ts`
if (require.main === module) {
  initializeDatabase();
  console.log("[Nexus DB] Database ready.");
  process.exit(0);
}
