import { getDb } from "./connection";
import { SCHEMA_SQL } from "./schema";

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

export function initializeDatabase(): void {
  const db = getDb();
  db.exec(SCHEMA_SQL);
  ensureIdentityPasswordColumn();
  ensureLlmProviderPurposeColumn();
  ensureMessageAttachmentsColumn();
  console.log("[Nexus DB] Schema initialized successfully.");
}

// Run directly with `tsx src/lib/db/init.ts`
if (require.main === module) {
  initializeDatabase();
  console.log("[Nexus DB] Database ready.");
  process.exit(0);
}
