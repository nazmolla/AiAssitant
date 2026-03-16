import { getDb } from "./connection";
import { SCHEMA_SQL } from "./schema";
import { encryptField, isEncrypted } from "./crypto";
import fs from "fs";
import path from "path";
import {
  ALL_TOOL_CATEGORIES,
  CUSTOM_TOOLS_REQUIRING_APPROVAL,
} from "@/lib/tools";
import { v4 as uuid } from "uuid";
import { env } from "@/lib/env";
import { encodeEmbeddingToBinary, decodeEmbeddingFromJson, normalizeCompression } from "@/lib/knowledge/vector-codec";

// ─── Helper: check if a table exists ─────────────────────────
function tableExists(table: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return !!row;
}

// ─── Allowed table names for dynamic PRAGMA / ALTER TABLE queries ──
const ALLOWED_TABLES = new Set([
  "identity_config", "llm_providers", "messages", "threads",
  "user_knowledge", "owner_profile", "user_profiles", "channels",
  "users", "user_permissions", "tool_policies", "agent_logs",
  "mcp_servers", "attachments", "webhooks", "api_keys",
  "approval_queue", "approval_preferences",
  "scheduler_schedules", "scheduler_tasks", "scheduler_runs",
  "scheduler_task_runs", "scheduler_claims", "scheduler_events",
  "knowledge_embeddings",
]);

// ─── Helper: get column names for a table ─────────────────────
function getColumns(table: string): Set<string> {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`getColumns: table "${table}" is not in the allowlist.`);
  }
  const db = getDb();
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[];
  return new Set(cols.map((c) => c.name));
}

// ─── Helper: idempotent ALTER TABLE ADD COLUMN ────────────────
// Gracefully handles "duplicate column name" from concurrent init calls
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const db = getDb();
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("duplicate column name")) throw err;
  }
}

function ensureIdentityPasswordColumn(): void {
  if (!tableExists("identity_config")) return;
  addColumnIfMissing("identity_config", "password_hash", "TEXT");
}

function ensureLlmProviderPurposeColumn(): void {
  if (!tableExists("llm_providers")) return;
  addColumnIfMissing("llm_providers", "purpose", "TEXT NOT NULL DEFAULT 'chat'");
}

function ensureMessageAttachmentsColumn(): void {
  if (!tableExists("messages")) return;
  addColumnIfMissing("messages", "attachments", "TEXT");
}

function ensureMessageCreatedAtColumn(): void {
  if (!tableExists("messages")) return;
  addColumnIfMissing("messages", "created_at", "DATETIME");
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
    ["url", "TEXT"],
    ["auth_type", "TEXT DEFAULT 'none'"],
    ["access_token", "TEXT"],
    ["client_id", "TEXT"],
    ["client_secret", "TEXT"],
    ["user_id", "TEXT"],
    ["scope", "TEXT DEFAULT 'global'"],
  ];

  for (const [col, def] of migrations) {
    if (!colNames.has(col)) {
      addColumnIfMissing("mcp_servers", col, def);
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
  // user_knowledge.user_id
  if (tableExists("user_knowledge") && !getColumns("user_knowledge").has("user_id")) {
    addColumnIfMissing("user_knowledge", "user_id", "TEXT");
    // Recreate unique index to include user_id
    try {
      const db = getDb();
      db.exec("DROP INDEX IF EXISTS idx_user_knowledge_unique");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_knowledge_unique ON user_knowledge(user_id, entity, attribute, value)");
    } catch {}
  }

  // threads.user_id
  if (tableExists("threads") && !getColumns("threads").has("user_id")) {
    addColumnIfMissing("threads", "user_id", "TEXT");
  }
}

function ensureThreadClassificationColumns(): void {
  if (!tableExists("threads")) return;
  const db = getDb();

  // Keep ALTER TABLE additions SQLite-safe for older databases by avoiding
  // strict NOT NULL migration patterns during column introduction.
  addColumnIfMissing("threads", "thread_type", "TEXT");
  addColumnIfMissing("threads", "is_interactive", "INTEGER");
  addColumnIfMissing("threads", "channel_id", "TEXT");
  addColumnIfMissing("threads", "external_sender_id", "TEXT");

  const cols = getColumns("threads");
  if (!cols.has("thread_type") || !cols.has("is_interactive")) {
    throw new Error("Failed to ensure threads classification columns (thread_type/is_interactive). Migration could not be applied.");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_threads_user_type_updated
    ON threads(user_id, thread_type, last_message_at DESC);

    CREATE INDEX IF NOT EXISTS idx_threads_channel_lookup
    ON threads(thread_type, channel_id, external_sender_id, status, last_message_at DESC);
  `);

  db.prepare(
    `UPDATE threads
     SET thread_type = 'proactive', is_interactive = 0
     WHERE title LIKE '[proactive-scan]%' OR title LIKE '[proactive-scan-followup]%'`
  ).run();

  db.prepare(
    `UPDATE threads
     SET thread_type = 'scheduled', is_interactive = 0
     WHERE title LIKE '[scheduled]%'`
  ).run();

  db.prepare(
    `UPDATE threads
     SET thread_type = 'scheduled', is_interactive = 0
     WHERE (title LIKE 'Job Scout Pipeline:%' OR title LIKE 'Batch Job:%')
       AND thread_type = 'interactive'`
  ).run();

  db.prepare(
    `UPDATE threads
     SET thread_type = 'channel', is_interactive = 0
     WHERE title LIKE 'channel:%'`
  ).run();

  db.prepare(
    `UPDATE threads
     SET thread_type = 'interactive'
     WHERE thread_type IS NULL OR trim(thread_type) = ''`
  ).run();

  db.prepare(
    `UPDATE threads
     SET is_interactive = CASE
       WHEN thread_type = 'interactive' THEN 1
       ELSE 0
     END
     WHERE is_interactive IS NULL`
  ).run();

  db.prepare(
    `UPDATE threads
     SET thread_type = 'interactive', is_interactive = 1
     WHERE thread_type NOT IN ('interactive', 'proactive', 'scheduled', 'channel') OR thread_type IS NULL`
  ).run();

  const channelRows = db.prepare(
    `SELECT id, title
     FROM threads
     WHERE thread_type = 'channel' AND (channel_id IS NULL OR external_sender_id IS NULL)`
  ).all() as { id: string; title: string | null }[];

  const updateStmt = db.prepare("UPDATE threads SET channel_id = ?, external_sender_id = ? WHERE id = ?");
  for (const row of channelRows) {
    const title = row.title || "";
    const match = /^channel:([^:]+):(.+)$/.exec(title);
    if (!match) continue;
    updateStmt.run(match[1], match[2], row.id);
  }
}

function ensureKnowledgeSourceTypeColumn(): void {
  if (!tableExists("user_knowledge")) return;
  const db = getDb();

  addColumnIfMissing("user_knowledge", "source_type", "TEXT NOT NULL DEFAULT 'manual'");
  db.exec("CREATE INDEX IF NOT EXISTS idx_user_knowledge_source_type ON user_knowledge(user_id, source_type, last_updated DESC)");

  db.prepare(
    `UPDATE user_knowledge
     SET source_type = CASE
       WHEN source_context LIKE '[proactive:%' THEN 'proactive'
       WHEN source_context LIKE '[chat:%' THEN 'chat'
       ELSE 'manual'
     END
     WHERE source_type IS NULL OR source_type = '' OR source_type = 'manual'`
  ).run();
}

function ensureKnowledgeEmbeddingStorageColumns(): void {
  if (!tableExists("knowledge_embeddings")) return;
  const db = getDb();

  addColumnIfMissing("knowledge_embeddings", "embedding_bin", "BLOB");
  addColumnIfMissing("knowledge_embeddings", "embedding_encoding", "TEXT NOT NULL DEFAULT 'f32le'");
  addColumnIfMissing("knowledge_embeddings", "compression", "TEXT NOT NULL DEFAULT 'none'");
  addColumnIfMissing("knowledge_embeddings", "is_archived", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("knowledge_embeddings", "updated_at", "DATETIME");

  db.prepare(
    `UPDATE knowledge_embeddings
     SET updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
     WHERE updated_at IS NULL`
  ).run();

  db.exec("CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_archived ON knowledge_embeddings(is_archived, updated_at DESC)");

  const rows = db
    .prepare(
      `SELECT knowledge_id, embedding
       FROM knowledge_embeddings
       WHERE embedding_bin IS NULL
         AND embedding IS NOT NULL
         AND length(embedding) > 0`
    )
    .all() as { knowledge_id: number; embedding: string }[];

  if (rows.length === 0) return;

  const compression = normalizeCompression(env.EMBEDDING_COMPRESSION);
  const updateStmt = db.prepare(
    `UPDATE knowledge_embeddings
     SET embedding_bin = ?,
         embedding_encoding = 'f32le',
         compression = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE knowledge_id = ?`
  );

  db.transaction(() => {
    for (const row of rows) {
      const parsed = decodeEmbeddingFromJson(row.embedding);
      if (!parsed || parsed.length === 0) continue;
      const encoded = encodeEmbeddingToBinary(parsed, compression);
      updateStmt.run(encoded.binary, encoded.compression, row.knowledge_id);
    }
  })();
}

function dedupeKnowledgeRows(): void {
  if (!tableExists("user_knowledge")) return;
  const db = getDb();

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_user_knowledge_norm_lookup
     ON user_knowledge(user_id, lower(trim(entity)), lower(trim(attribute)), lower(trim(value)))`
  );

  const hasDup = db
    .prepare(
      `SELECT 1
       FROM user_knowledge k1
       JOIN user_knowledge k2
         ON coalesce(k1.user_id, '') = coalesce(k2.user_id, '')
        AND lower(trim(k1.entity)) = lower(trim(k2.entity))
        AND lower(trim(k1.attribute)) = lower(trim(k2.attribute))
        AND lower(trim(k1.value)) = lower(trim(k2.value))
        AND (
          k1.last_updated < k2.last_updated
          OR (k1.last_updated = k2.last_updated AND k1.id < k2.id)
        )
       LIMIT 1`
    )
    .get() as { 1: number } | undefined;

  if (!hasDup) return;

  const removed = db
    .prepare(
      `DELETE FROM user_knowledge
       WHERE id IN (
         SELECT k1.id
         FROM user_knowledge k1
         JOIN user_knowledge k2
           ON coalesce(k1.user_id, '') = coalesce(k2.user_id, '')
          AND lower(trim(k1.entity)) = lower(trim(k2.entity))
          AND lower(trim(k1.attribute)) = lower(trim(k2.attribute))
          AND lower(trim(k1.value)) = lower(trim(k2.value))
          AND (
            k1.last_updated < k2.last_updated
            OR (k1.last_updated = k2.last_updated AND k1.id < k2.id)
          )
       )`
    )
    .run();

  if (Number(removed.changes || 0) > 0) {
    console.log(`[Nexus DB] Deduplicated ${removed.changes} normalized knowledge rows.`);
  }

  // Shrink oversized legacy source context fields to reduce storage bloat.
  db.prepare(
    `UPDATE user_knowledge
     SET source_context = substr(source_context, 1, 220)
     WHERE source_context IS NOT NULL AND length(source_context) > 220`
  ).run();
}

/**
 * Collect the names of built-in tools that require approval by default.
 */
function buildApprovalRequiredSet(): Set<string> {
  const names = new Set<string>();
  // Collect from all tool categories
  for (const category of ALL_TOOL_CATEGORIES) {
    for (const toolName of category.toolsRequiringApproval) {
      names.add(toolName);
    }
  }
  // Also include custom tools requiring approval
  for (const toolName of CUSTOM_TOOLS_REQUIRING_APPROVAL) {
    names.add(toolName);
  }
  return names;
}

/**
 * Seed policies for ALL built-in tools discovered from ALL_TOOL_CATEGORIES.
 * Tools in the "requiring approval" sets get requires_approval=1;
 * all others default to requires_approval=0.  Uses INSERT OR IGNORE so
 * existing policies (e.g. customised by admin) are never overwritten.
 */
function seedAllBuiltinToolPolicies(): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO tool_policies (tool_name, mcp_id, requires_approval, scope)
     VALUES (?, NULL, ?, 'global')`
  );

  const allBuiltinTools = ALL_TOOL_CATEGORIES.flatMap((category) => category.tools);
  const toolsRequiringApproval = buildApprovalRequiredSet();

  // Wrap in a transaction for atomicity and performance (single fsync)
  db.transaction(() => {
    for (const tool of allBuiltinTools) {
      const needsApproval = toolsRequiringApproval.has(tool.name) ? 1 : 0;
      stmt.run(tool.name, needsApproval);
    }
  })();
}

function ensureEmailToolPolicyDefaults(): void {
  const db = getDb();
  db.prepare("UPDATE tool_policies SET requires_approval = 0 WHERE tool_name = ?").run("builtin.email_send");
}

function ensureScreenSharingColumn(): void {
  for (const table of ["owner_profile", "user_profiles"] as const) {
    if (!tableExists(table)) continue;
    addColumnIfMissing(table, "screen_sharing_enabled", "INTEGER DEFAULT 1");
  }
}

function ensureToolPolicyScopeColumn(): void {
  if (!tableExists("tool_policies")) return;
  addColumnIfMissing("tool_policies", "scope", "TEXT DEFAULT 'global'");
}

/**
 * Drop the legacy `is_proactive_enabled` column from tool_policies.
 * The proactive agent now has access to all tools — only `requires_approval` gates execution.
 */
function dropToolPolicyProactiveColumn(): void {
  const db = getDb();
  if (!tableExists("tool_policies")) return;
  const cols = getColumns("tool_policies");
  if (!cols.has("is_proactive_enabled")) return;

  db.exec(`
    CREATE TABLE tool_policies_new (
      tool_name TEXT PRIMARY KEY,
      mcp_id TEXT REFERENCES mcp_servers(id),
      requires_approval BOOLEAN DEFAULT 1,
      scope TEXT DEFAULT 'global'
    );
    INSERT INTO tool_policies_new (tool_name, mcp_id, requires_approval, scope)
      SELECT tool_name, mcp_id, requires_approval, COALESCE(scope, 'global') FROM tool_policies;
    DROP TABLE tool_policies;
    ALTER TABLE tool_policies_new RENAME TO tool_policies;
  `);
}

/**
 * Add `enabled` column to users table and ensure user_permissions table.
 */
/**
 * Add user_id column to channels table for user-specific channels.
 */
function ensureChannelUserId(): void {
  const db = getDb();
  if (tableExists("channels") && !getColumns("channels").has("user_id")) {
    addColumnIfMissing("channels", "user_id", "TEXT REFERENCES users(id) ON DELETE CASCADE");
  }
  // Back-fill: assign orphan channels to the first admin user
  if (tableExists("channels") && tableExists("users")) {
    const orphans = db.prepare("SELECT id FROM channels WHERE user_id IS NULL").all() as { id: string }[];
    if (orphans.length > 0) {
      const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
      if (admin) {
        db.prepare("UPDATE channels SET user_id = ? WHERE user_id IS NULL").run(admin.id);
        console.log(`[Nexus DB] Assigned ${orphans.length} orphan channel(s) to admin ${admin.id}`);
      }
    }
  }
}

function ensureUserAccessManagement(): void {
  const db = getDb();
  // Add enabled column to users table
  if (tableExists("users") && !getColumns("users").has("enabled")) {
    addColumnIfMissing("users", "enabled", "INTEGER DEFAULT 1");
  }
  // Auto-create permissions rows for users that don't have one yet
  if (tableExists("users") && tableExists("user_permissions")) {
    const usersWithout = db.prepare(
      `SELECT u.id, u.role FROM users u LEFT JOIN user_permissions p ON u.id = p.user_id WHERE p.user_id IS NULL`
    ).all() as { id: string; role: string }[];
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO user_permissions (user_id, chat, knowledge, dashboard, approvals, mcp_servers, channels, llm_config, screen_sharing)
       VALUES (?, 1, 1, 1, 1, 1, ?, ?, 1)`
    );
    for (const u of usersWithout) {
      // Admins get full access, users get restricted defaults
      const isAdmin = u.role === "admin";
      stmt.run(u.id, isAdmin ? 1 : 0, isAdmin ? 1 : 0);
    }
  }
}

function ensureProfilePreferencesColumns(): void {
  for (const table of ["owner_profile", "user_profiles"] as const) {
    if (!tableExists(table)) continue;
    addColumnIfMissing(table, "avatar_url", "TEXT DEFAULT ''");
    addColumnIfMissing(table, "theme", "TEXT DEFAULT 'ember'");
    addColumnIfMissing(table, "font", "TEXT DEFAULT 'inter'");
    addColumnIfMissing(table, "timezone", "TEXT DEFAULT ''");
    addColumnIfMissing(table, "notification_level", "TEXT DEFAULT 'disaster'");
    addColumnIfMissing(table, "tts_voice", "TEXT DEFAULT 'nova'");
  }
}

function normalizeAgentLogLevels(): void {
  const db = getDb();
  if (!tableExists("agent_logs")) return;

  db.prepare(
    `UPDATE agent_logs
     SET level = CASE
       WHEN lower(coalesce(level, '')) IN ('critical', 'fatal', 'panic') THEN 'critical'
       WHEN lower(coalesce(level, '')) IN ('error', 'err') THEN 'error'
       WHEN lower(coalesce(level, '')) IN ('warning', 'warn') THEN 'warning'
       ELSE 'verbose'
     END`
  ).run();
}

function ensureServerLoggingDefaults(): void {
  const db = getDb();
  if (!tableExists("app_config")) return;

  db.prepare(
    `INSERT OR IGNORE INTO app_config (key, value, updated_at)
     VALUES ('log_level_min', 'verbose', CURRENT_TIMESTAMP)`
  ).run();
}

/**
 * Encrypt any existing plaintext secrets in the database.
 * Runs on every startup to catch legacy unencrypted data.
 * Already-encrypted values (with the "enc:v1:" prefix) are skipped.
 */
function encryptExistingSecrets(): void {
  const db = getDb();

  db.transaction(() => {
    // MCP servers: access_token, client_secret
    if (tableExists("mcp_servers")) {
      const servers = db.prepare("SELECT id, access_token, client_secret FROM mcp_servers").all() as {
        id: string; access_token: string | null; client_secret: string | null;
      }[];
      const stmt = db.prepare("UPDATE mcp_servers SET access_token = ?, client_secret = ? WHERE id = ?");
      for (const s of servers) {
        const needsUpdate =
          (s.access_token && !isEncrypted(s.access_token)) ||
          (s.client_secret && !isEncrypted(s.client_secret));
        if (needsUpdate) {
          stmt.run(
            s.access_token ? encryptField(s.access_token) : null,
            s.client_secret ? encryptField(s.client_secret) : null,
            s.id
          );
        }
      }
    }

    // Auth providers: client_secret, bot_token
    if (tableExists("auth_providers")) {
      const providers = db.prepare("SELECT id, client_secret, bot_token FROM auth_providers").all() as {
        id: string; client_secret: string | null; bot_token: string | null;
      }[];
      const stmt = db.prepare("UPDATE auth_providers SET client_secret = ?, bot_token = ? WHERE id = ?");
      for (const p of providers) {
        const needsUpdate =
          (p.client_secret && !isEncrypted(p.client_secret)) ||
          (p.bot_token && !isEncrypted(p.bot_token));
        if (needsUpdate) {
          stmt.run(
            p.client_secret ? encryptField(p.client_secret) : null,
            p.bot_token ? encryptField(p.bot_token) : null,
            p.id
          );
        }
      }
    }

    // Channels: config_json, webhook_secret
    if (tableExists("channels")) {
      const channels = db.prepare("SELECT id, config_json, webhook_secret FROM channels").all() as {
        id: string; config_json: string; webhook_secret: string | null;
      }[];
      const stmt = db.prepare("UPDATE channels SET config_json = ?, webhook_secret = ? WHERE id = ?");
      for (const c of channels) {
        const needsUpdate =
          (c.config_json && !isEncrypted(c.config_json)) ||
          (c.webhook_secret && !isEncrypted(c.webhook_secret));
        if (needsUpdate) {
          stmt.run(
            encryptField(c.config_json),
            c.webhook_secret ? encryptField(c.webhook_secret) : null,
            c.id
          );
        }
      }
    }

    // LLM providers: config_json
    if (tableExists("llm_providers")) {
      const providers = db.prepare("SELECT id, config_json FROM llm_providers").all() as {
        id: string; config_json: string;
      }[];
      const stmt = db.prepare("UPDATE llm_providers SET config_json = ? WHERE id = ?");
      for (const p of providers) {
        if (p.config_json && !isEncrypted(p.config_json)) {
          stmt.run(encryptField(p.config_json), p.id);
        }
      }
    }
  })();
}

function ensureChannelImapUidColumns(): void {
  if (!tableExists("channels")) return;
  addColumnIfMissing("channels", "last_imap_uid", "INTEGER DEFAULT 0");
  addColumnIfMissing("channels", "last_imap_uidvalidity", "INTEGER DEFAULT 0");
}

function ensureApprovalQueueNlRequestColumn(): void {
  if (!tableExists("approval_queue")) return;
  addColumnIfMissing("approval_queue", "nl_request", "TEXT");
  addColumnIfMissing("approval_queue", "source", "TEXT DEFAULT 'chat'");
}

function ensureApprovalPreferencesTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      request_key TEXT NOT NULL,
      device_key TEXT NOT NULL,
      reason_key TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'ignored')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, tool_name, request_key, device_key, reason_key)
    );
    CREATE INDEX IF NOT EXISTS idx_approval_prefs_lookup
      ON approval_preferences(user_id, tool_name, request_key, device_key, reason_key);
  `);
}

function cronToIntervalExpr(cron: string): string {
  const trimmed = String(cron || "").trim();
  const everyMinute = /^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/i.exec(trimmed);
  if (everyMinute) return `every:${Math.max(1, Number(everyMinute[1]))}:minute`;
  if (trimmed === "0 * * * *") return "every:1:hour";
  if (trimmed === "0 0 * * *") return "every:1:day";
  if (trimmed === "0 0 * * 0") return "every:1:week";
  return "every:15:minute";
}

function ensureSystemUnifiedSchedules(): void {
  const db = getDb();
  if (!tableExists("scheduler_schedules") || !tableExists("scheduler_tasks")) return;

  const proactiveCron = db.prepare("SELECT value FROM app_config WHERE key = 'proactive_cron_schedule'").get() as { value?: string } | undefined;
  const kmEnabledRow = db.prepare("SELECT value FROM app_config WHERE key = 'knowledge_maintenance_enabled'").get() as { value?: string } | undefined;
  const kmPollRow = db.prepare("SELECT value FROM app_config WHERE key = 'knowledge_maintenance_poll_seconds'").get() as { value?: string } | undefined;

  const proactiveExpr = cronToIntervalExpr(proactiveCron?.value || "*/15 * * * *");
  const kmEnabledRaw = String(kmEnabledRow?.value || "1").trim().toLowerCase();
  const kmEnabled = kmEnabledRaw !== "0" && kmEnabledRaw !== "false" && kmEnabledRaw !== "no";
  const kmPollSeconds = Math.max(30, Math.min(300, Number.parseInt(String(kmPollRow?.value || "60"), 10) || 60));

  const upsertSchedule = db.prepare(
    `INSERT INTO scheduler_schedules (
      id, schedule_key, name, owner_type, owner_id, handler_type,
      trigger_type, trigger_expr, timezone, status, max_concurrency,
      retry_policy_json, misfire_policy, next_run_at
    ) VALUES (?, ?, ?, 'system', NULL, ?, 'interval', ?, 'UTC', ?, 1, ?, 'run_immediately', datetime('now'))
    ON CONFLICT(schedule_key) DO UPDATE SET
      name = excluded.name,
      trigger_type = excluded.trigger_type,
      trigger_expr = excluded.trigger_expr,
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP`
  );

  const upsertTask = db.prepare(
    `INSERT INTO scheduler_tasks (
      id, schedule_id, task_key, name, handler_name, execution_mode,
      sequence_no, enabled, config_json
    ) VALUES (?, ?, ?, ?, ?, 'sync', ?, 1, ?)
    ON CONFLICT(schedule_id, task_key) DO UPDATE SET
      name = excluded.name,
      handler_name = excluded.handler_name,
      execution_mode = excluded.execution_mode,
      sequence_no = excluded.sequence_no,
      enabled = excluded.enabled,
      config_json = excluded.config_json,
      updated_at = CURRENT_TIMESTAMP`
  );

  const ensureByKey = (scheduleKey: string): string => {
    const existing = db.prepare("SELECT id FROM scheduler_schedules WHERE schedule_key = ?").get(scheduleKey) as { id: string } | undefined;
    return existing?.id || uuid();
  };

  const tx = db.transaction(() => {
    const proactiveId = ensureByKey("system.proactive.scan");
    upsertSchedule.run(
      proactiveId,
      "system.proactive.scan",
      "System Proactive Scan",
      "system.proactive",
      proactiveExpr,
      "active",
      JSON.stringify({ strategy: "none", maxAttempts: 1 })
    );
    upsertTask.run(
      `sched_task_${proactiveId}_primary`,
      proactiveId,
      "primary",
      "Run proactive scan",
      "system.proactive.scan",
      0,
      JSON.stringify({ source: "unified" })
    );

    const dbMaintId = ensureByKey("system.db_maintenance.run_due");
    upsertSchedule.run(
      dbMaintId,
      "system.db_maintenance.run_due",
      "System DB Maintenance",
      "system.db_maintenance",
      "every:1:hour",
      "active",
      JSON.stringify({ strategy: "none", maxAttempts: 1 })
    );
    upsertTask.run(
      `sched_task_${dbMaintId}_primary`,
      dbMaintId,
      "primary",
      "Run DB maintenance if due",
      "system.db_maintenance.run_due",
      0,
      JSON.stringify({ source: "unified" })
    );

    const kmId = ensureByKey("system.knowledge_maintenance.run_due");
    upsertSchedule.run(
      kmId,
      "system.knowledge_maintenance.run_due",
      "System Knowledge Maintenance",
      "system.knowledge_maintenance",
      `every:${kmPollSeconds}:second`,
      kmEnabled ? "active" : "paused",
      JSON.stringify({ strategy: "none", maxAttempts: 1 })
    );
    upsertTask.run(
      `sched_task_${kmId}_primary`,
      kmId,
      "primary",
      "Run knowledge maintenance if due",
      "system.knowledge_maintenance.run_due",
      0,
      JSON.stringify({ source: "unified" })
    );

    const jobScoutId = ensureByKey("workflow.job_scout.pipeline");
    upsertSchedule.run(
      jobScoutId,
      "workflow.job_scout.pipeline",
      "Job Scout Pipeline",
      "workflow.job_scout",
      "every:1:day",
      "paused",
      JSON.stringify({ strategy: "none", maxAttempts: 1 })
    );

    const pipelineTasks = [
      { key: "search", name: "Search listings", handler: "workflow.job_scout.search" },
      { key: "extract", name: "Extract role details", handler: "workflow.job_scout.extract" },
      { key: "prepare", name: "Prepare tailored resume", handler: "workflow.job_scout.prepare" },
      { key: "validate", name: "Validate shortlist", handler: "workflow.job_scout.validate" },
      { key: "email", name: "Send digest email", handler: "workflow.job_scout.email" },
    ];

    for (let i = 0; i < pipelineTasks.length; i += 1) {
      const task = pipelineTasks[i];
      upsertTask.run(
        `sched_task_${jobScoutId}_${task.key}`,
        jobScoutId,
        task.key,
        task.name,
        task.handler,
        i,
        JSON.stringify({ source: "unified" })
      );
    }
  });

  tx();
}

let _dbInitialized = false;

export function initializeDatabase(): void {
  if (_dbInitialized) return;
  const db = getDb();
  db.exec(SCHEMA_SQL);
  ensureIdentityPasswordColumn();
  ensureLlmProviderPurposeColumn();
  ensureMessageAttachmentsColumn();
  ensureMessageCreatedAtColumn();
  ensureUserIdColumns();
  ensureThreadClassificationColumns();
  ensureKnowledgeSourceTypeColumn();
  ensureKnowledgeEmbeddingStorageColumns();
  if (env.NEXUS_DEDUPE_KNOWLEDGE_STARTUP) {
    dedupeKnowledgeRows();
  }
  ensureMcpServerNewColumns();
  ensureScreenSharingColumn();
  ensureToolPolicyScopeColumn();
  dropToolPolicyProactiveColumn();
  migrateToMultiUser();
  ensureChannelUserId();
  ensureChannelImapUidColumns();
  ensureApprovalQueueNlRequestColumn();
  ensureApprovalPreferencesTable();
  ensureSystemUnifiedSchedules();
  ensureUserAccessManagement();
  ensureProfilePreferencesColumns();
  normalizeAgentLogLevels();
  ensureServerLoggingDefaults();
  seedAllBuiltinToolPolicies();
  ensureEmailToolPolicyDefaults();
  encryptExistingSecrets();
  revokeExpiredKeys();
  warnIfDbShrunk();
  _dbInitialized = true;
  console.log("[Nexus DB] Schema initialized successfully.");
}

/**
 * Compare current DB size against backups.
 * If the DB is dramatically smaller than the largest backup,
 * it may have been re-created from scratch — log a critical warning.
 */
function warnIfDbShrunk(): void {
  try {
    const dbPath = env.DATABASE_PATH;
    const dbSize = fs.statSync(dbPath).size;
    const dir = path.dirname(dbPath);
    const base = path.basename(dbPath);
    const backupSizes = fs.readdirSync(dir)
      .filter(f => f.startsWith(`${base}.backup_`))
      .map(f => { try { return fs.statSync(path.join(dir, f)).size; } catch { return 0; } })
      .filter(s => s > 0);
    if (backupSizes.length > 0) {
      const largest = Math.max(...backupSizes);
      if (largest > 50 * 1024 * 1024 && dbSize < largest * 0.1) {
        console.error(
          `[Nexus DB] ⚠ CRITICAL: DB is ${(dbSize / 1e6).toFixed(1)} MB ` +
          `but largest backup is ${(largest / 1e6).toFixed(1)} MB — possible data loss!`
        );
      }
    }
  } catch { /* non-critical — don't block startup */ }
}

/** Clean up any API keys that have passed their expiry date. */
function revokeExpiredKeys(): void {
  try {
    const { revokeExpiredApiKeys } = require("./queries");
    const purged = revokeExpiredApiKeys();
    if (purged > 0) console.log(`[Nexus DB] Revoked ${purged} expired API key(s).`);
  } catch { /* queries may not be loaded yet during first init */ }
}

// Run directly with `tsx src/lib/db/init.ts`
if (require.main === module) {
  initializeDatabase();
  console.log("[Nexus DB] Database ready.");
  process.exit(0);
}
