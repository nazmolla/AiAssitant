import { getDb } from "./connection";
import { SCHEMA_SQL } from "./schema";
import { FS_TOOLS_REQUIRING_APPROVAL } from "@/lib/agent/fs-tools";
import { v4 as uuid } from "uuid";

// ─── Helper: check if a table exists ─────────────────────────
function tableExists(table: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return !!row;
}

// ─── Helper: get column names for a table ─────────────────────
function getColumns(table: string): Set<string> {
  const db = getDb();
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[];
  return new Set(cols.map((c) => c.name));
}

function ensureIdentityPasswordColumn(): void {
  const db = getDb();
  if (!tableExists("identity_config")) return;
  const cols = getColumns("identity_config");
  if (!cols.has("password_hash")) {
    db.prepare("ALTER TABLE identity_config ADD COLUMN password_hash TEXT").run();
  }
}

function ensureLlmProviderPurposeColumn(): void {
  const db = getDb();
  if (!tableExists("llm_providers")) return;
  const cols = getColumns("llm_providers");
  if (!cols.has("purpose")) {
    db.prepare("ALTER TABLE llm_providers ADD COLUMN purpose TEXT NOT NULL DEFAULT 'chat'").run();
  }
}

function ensureMessageAttachmentsColumn(): void {
  const db = getDb();
  if (!tableExists("messages")) return;
  const cols = getColumns("messages");
  if (!cols.has("attachments")) {
    db.prepare("ALTER TABLE messages ADD COLUMN attachments TEXT").run();
  }
}

function ensureMcpServerNewColumns(): void {
  const db = getDb();
  if (!tableExists("mcp_servers")) return;
  const columns = db.prepare("PRAGMA table_info(mcp_servers)").all() as { name: string; notnull: number }[];
  const colNames = new Set(columns.map((c) => c.name));

  // Check if `command` column is still NOT NULL (old schema).
  const commandCol = columns.find((c) => c.name === "command");
  if (commandCol && commandCol.notnull === 1) {
    db.exec(`
      CREATE TABLE mcp_servers_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport_type TEXT,
        command TEXT,
        args TEXT,
        env_vars TEXT,
        url TEXT,
        auth_type TEXT DEFAULT 'none',
        access_token TEXT,
        client_id TEXT,
        client_secret TEXT,
        user_id TEXT,
        scope TEXT DEFAULT 'global'
      );
      INSERT INTO mcp_servers_new (id, name, transport_type, command, args, env_vars${colNames.has("url") ? ", url, auth_type, access_token, client_id, client_secret" : ""})
        SELECT id, name, transport_type, command, args, env_vars${colNames.has("url") ? ", url, auth_type, access_token, client_id, client_secret" : ""} FROM mcp_servers;
      DROP TABLE mcp_servers;
      ALTER TABLE mcp_servers_new RENAME TO mcp_servers;
    `);
    return;
  }

  // Otherwise just add any missing columns
  const migrations: [string, string][] = [
    ["url", "ALTER TABLE mcp_servers ADD COLUMN url TEXT"],
    ["auth_type", "ALTER TABLE mcp_servers ADD COLUMN auth_type TEXT DEFAULT 'none'"],
    ["access_token", "ALTER TABLE mcp_servers ADD COLUMN access_token TEXT"],
    ["client_id", "ALTER TABLE mcp_servers ADD COLUMN client_id TEXT"],
    ["client_secret", "ALTER TABLE mcp_servers ADD COLUMN client_secret TEXT"],
    ["user_id", "ALTER TABLE mcp_servers ADD COLUMN user_id TEXT"],
    ["scope", "ALTER TABLE mcp_servers ADD COLUMN scope TEXT DEFAULT 'global'"],
  ];

  for (const [col, sql] of migrations) {
    if (!colNames.has(col)) {
      db.prepare(sql).run();
    }
  }
}

/**
 * Migrate existing single-owner data to multi-user schema.
 * - Creates the first admin user from identity_config
 * - Back-fills user_id on threads & user_knowledge
 */
function migrateToMultiUser(): void {
  const db = getDb();
  if (!tableExists("users")) return;

  // If users table already has rows, skip migration
  const count = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
  if (count.c > 0) return;

  // Check if there's an existing identity_config to migrate from
  if (!tableExists("identity_config")) return;
  const identity = db.prepare("SELECT * FROM identity_config WHERE id = 1").get() as {
    owner_email: string;
    provider_id: string;
    external_sub_id: string | null;
    password_hash: string | null;
  } | undefined;

  if (!identity) return;

  // Create the first admin user
  const userId = uuid();
  db.prepare(
    `INSERT INTO users (id, email, display_name, provider_id, external_sub_id, password_hash, role)
     VALUES (?, ?, ?, ?, ?, ?, 'admin')`
  ).run(
    userId,
    identity.owner_email,
    identity.owner_email.split("@")[0],
    identity.provider_id,
    identity.external_sub_id,
    identity.password_hash
  );

  // Back-fill user_id on user_knowledge rows
  if (tableExists("user_knowledge") && getColumns("user_knowledge").has("user_id")) {
    db.prepare("UPDATE user_knowledge SET user_id = ? WHERE user_id IS NULL").run(userId);
  }

  // Back-fill user_id on threads
  if (tableExists("threads") && getColumns("threads").has("user_id")) {
    db.prepare("UPDATE threads SET user_id = ? WHERE user_id IS NULL").run(userId);
  }

  // Migrate owner_profile → user_profiles
  if (tableExists("owner_profile") && tableExists("user_profiles")) {
    const profile = db.prepare("SELECT * FROM owner_profile WHERE id = 1").get() as Record<string, unknown> | undefined;
    if (profile) {
      db.prepare(
        `INSERT OR IGNORE INTO user_profiles (user_id, display_name, title, bio, location, phone, email, website, linkedin, github, twitter, skills, languages, company, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).run(
        userId,
        profile.display_name ?? "",
        profile.title ?? "",
        profile.bio ?? "",
        profile.location ?? "",
        profile.phone ?? "",
        profile.email ?? "",
        profile.website ?? "",
        profile.linkedin ?? "",
        profile.github ?? "",
        profile.twitter ?? "",
        profile.skills ?? "[]",
        profile.languages ?? "[]",
        profile.company ?? ""
      );
    }
  }

  console.log(`[Nexus DB] Migrated single-owner to multi-user. Admin user: ${identity.owner_email} (${userId})`);
}

/**
 * Add user_id column to existing tables that don't have it yet.
 */
function ensureUserIdColumns(): void {
  const db = getDb();

  // user_knowledge.user_id
  if (tableExists("user_knowledge") && !getColumns("user_knowledge").has("user_id")) {
    db.prepare("ALTER TABLE user_knowledge ADD COLUMN user_id TEXT").run();
    // Recreate unique index to include user_id
    try {
      db.exec("DROP INDEX IF EXISTS idx_user_knowledge_unique");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_knowledge_unique ON user_knowledge(user_id, entity, attribute, value)");
    } catch {}
  }

  // threads.user_id
  if (tableExists("threads") && !getColumns("threads").has("user_id")) {
    db.prepare("ALTER TABLE threads ADD COLUMN user_id TEXT").run();
  }
}

/**
 * Seed approval-required policies for destructive filesystem tools.
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

function ensureScreenSharingColumn(): void {
  const db = getDb();
  for (const table of ["owner_profile", "user_profiles"] as const) {
    if (!tableExists(table)) continue;
    const cols = getColumns(table);
    if (!cols.has("screen_sharing_enabled")) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN screen_sharing_enabled INTEGER DEFAULT 1`).run();
    }
  }
}

export function initializeDatabase(): void {
  const db = getDb();
  db.exec(SCHEMA_SQL);
  ensureIdentityPasswordColumn();
  ensureLlmProviderPurposeColumn();
  ensureMessageAttachmentsColumn();
  ensureUserIdColumns();
  ensureMcpServerNewColumns();
  ensureScreenSharingColumn();
  migrateToMultiUser();
  seedFsToolPolicies();
  console.log("[Nexus DB] Schema initialized successfully.");
}

// Run directly with `tsx src/lib/db/init.ts`
if (require.main === module) {
  initializeDatabase();
  console.log("[Nexus DB] Database ready.");
  process.exit(0);
}
