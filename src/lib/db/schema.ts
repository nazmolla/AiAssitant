export const SCHEMA_SQL = `
-- ═══ Users ═══

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                -- UUID
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    provider_id TEXT NOT NULL,          -- 'local' | 'azure-ad' | 'google'
    external_sub_id TEXT,               -- OIDC Subject ID (unique per provider)
    password_hash TEXT,                 -- bcrypt hash for local auth
    role TEXT NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
    enabled INTEGER NOT NULL DEFAULT 1, -- 0 = disabled, 1 = active
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ Multi-Email Support (issue #82) ═══

CREATE TABLE IF NOT EXISTS user_emails (
    id TEXT PRIMARY KEY,                -- UUID
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,         -- Additional email address (must be globally unique)
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_emails_user ON user_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_user_emails_email ON user_emails(email COLLATE NOCASE);

-- ═══ Identity & Configuration (legacy — kept for migration) ═══

CREATE TABLE IF NOT EXISTS identity_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    owner_email TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    external_sub_id TEXT UNIQUE,
    password_hash TEXT,
    api_keys_encrypted TEXT
);

-- ═══ User Profiles (per-user) ═══

CREATE TABLE IF NOT EXISTS owner_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    display_name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT DEFAULT '',
    title TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    location TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    website TEXT DEFAULT '',
    linkedin TEXT DEFAULT '',
    github TEXT DEFAULT '',
    twitter TEXT DEFAULT '',
    skills TEXT DEFAULT '[]',
    languages TEXT DEFAULT '[]',
    company TEXT DEFAULT '',
    screen_sharing_enabled INTEGER DEFAULT 1,
    notification_level TEXT DEFAULT 'disaster',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT DEFAULT '',
    title TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    location TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    website TEXT DEFAULT '',
    linkedin TEXT DEFAULT '',
    github TEXT DEFAULT '',
    twitter TEXT DEFAULT '',
    skills TEXT DEFAULT '[]',
    languages TEXT DEFAULT '[]',
    company TEXT DEFAULT '',
    screen_sharing_enabled INTEGER DEFAULT 1,
    notification_level TEXT DEFAULT 'disaster',
    theme TEXT DEFAULT 'ember',
    font TEXT DEFAULT 'inter',
    timezone TEXT DEFAULT '',
    tts_voice TEXT DEFAULT 'nova',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ Server-Wide App Config ═══

CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ MCP Servers (user_id NULL = global) ═══

CREATE TABLE IF NOT EXISTS mcp_servers (
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
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT DEFAULT 'global'         -- 'global' | 'user'
);

CREATE TABLE IF NOT EXISTS llm_providers (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'chat',
    config_json TEXT NOT NULL,
    is_default BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ Memory & Knowledge (per-user) ═══

CREATE TABLE IF NOT EXISTS user_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    entity TEXT NOT NULL,
    attribute TEXT NOT NULL,
    value TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'manual', -- manual | chat | proactive
    source_context TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_knowledge_unique
    ON user_knowledge(user_id, entity, attribute, value);

CREATE INDEX IF NOT EXISTS idx_user_knowledge_user_id ON user_knowledge(user_id);
CREATE INDEX IF NOT EXISTS idx_user_knowledge_entity ON user_knowledge(user_id, entity);
CREATE INDEX IF NOT EXISTS idx_user_knowledge_attribute ON user_knowledge(user_id, attribute);

CREATE TABLE IF NOT EXISTS knowledge_embeddings (
    knowledge_id INTEGER PRIMARY KEY REFERENCES user_knowledge(id) ON DELETE CASCADE,
    embedding TEXT,
    embedding_bin BLOB,
    embedding_encoding TEXT NOT NULL DEFAULT 'f32le',
    compression TEXT NOT NULL DEFAULT 'none',
    is_archived INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ Threads (per-user) ═══

CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    thread_type TEXT NOT NULL DEFAULT 'interactive', -- interactive | proactive | scheduled | channel
    is_interactive INTEGER NOT NULL DEFAULT 1,
    channel_id TEXT,
    external_sender_id TEXT,
    status TEXT DEFAULT 'active',
    last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT REFERENCES threads(id),
    role TEXT CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT,
    tool_calls TEXT,
    tool_results TEXT,
    attachments TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    thread_id TEXT REFERENCES threads(id),
    message_id INTEGER REFERENCES messages(id),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ Safety & Proactive Actions ═══

CREATE TABLE IF NOT EXISTS tool_policies (
    tool_name TEXT PRIMARY KEY,
    mcp_id TEXT REFERENCES mcp_servers(id),
    requires_approval BOOLEAN DEFAULT 1,
    scope TEXT DEFAULT 'global'          -- 'global' | 'user'
);

CREATE TABLE IF NOT EXISTS approval_queue (
    id TEXT PRIMARY KEY,
    thread_id TEXT REFERENCES threads(id),
    tool_name TEXT,
    args TEXT,
    reasoning TEXT,
    nl_request TEXT,
    source TEXT DEFAULT 'chat',
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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

-- ═══ Notifications ═══

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    metadata TEXT,
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- ═══ Unified Scheduler Foundation ═══

CREATE TABLE IF NOT EXISTS scheduler_schedules (
    id TEXT PRIMARY KEY,
    schedule_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    owner_type TEXT NOT NULL DEFAULT 'system',         -- system | user | agent
    owner_id TEXT,
    handler_type TEXT NOT NULL,                        -- executor routing key (agent/task/etc)
    trigger_type TEXT NOT NULL DEFAULT 'interval',     -- cron | interval | once
    trigger_expr TEXT NOT NULL,                        -- cron string or interval descriptor
    timezone TEXT NOT NULL DEFAULT 'UTC',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived')),
    max_concurrency INTEGER NOT NULL DEFAULT 1,
    retry_policy_json TEXT,
    misfire_policy TEXT NOT NULL DEFAULT 'run_immediately' CHECK(misfire_policy IN ('run_immediately', 'skip', 'catch_up')),
    next_run_at DATETIME,
    last_run_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scheduler_tasks (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL REFERENCES scheduler_schedules(id) ON DELETE CASCADE,
    task_key TEXT NOT NULL,
    name TEXT NOT NULL,
    handler_name TEXT NOT NULL,
    execution_mode TEXT NOT NULL DEFAULT 'sync' CHECK(execution_mode IN ('sync', 'async', 'fanout')),
    sequence_no INTEGER NOT NULL DEFAULT 0,
    depends_on_task_id TEXT REFERENCES scheduler_tasks(id) ON DELETE SET NULL,
    timeout_sec INTEGER,
    retry_policy_json TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    config_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(schedule_id, task_key)
);

CREATE TABLE IF NOT EXISTS scheduler_runs (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL REFERENCES scheduler_schedules(id) ON DELETE CASCADE,
    trigger_source TEXT NOT NULL DEFAULT 'timer' CHECK(trigger_source IN ('timer', 'manual', 'api', 'recovery')),
    planned_at DATETIME,
    started_at DATETIME,
    finished_at DATETIME,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'queued', 'claimed', 'running', 'success', 'partial_success', 'failed', 'cancelled', 'timeout')),
    attempt_no INTEGER NOT NULL DEFAULT 1,
    correlation_id TEXT,
    summary_json TEXT,
    error_code TEXT,
    error_message TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scheduler_task_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES scheduler_runs(id) ON DELETE CASCADE,
    schedule_task_id TEXT NOT NULL REFERENCES scheduler_tasks(id) ON DELETE CASCADE,
    started_at DATETIME,
    finished_at DATETIME,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'skipped', 'running', 'success', 'failed', 'cancelled', 'timeout', 'retrying')),
    attempt_no INTEGER NOT NULL DEFAULT 1,
    output_json TEXT,
    error_code TEXT,
    error_message TEXT,
    log_ref TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scheduler_claims (
    run_id TEXT PRIMARY KEY REFERENCES scheduler_runs(id) ON DELETE CASCADE,
    worker_id TEXT NOT NULL,
    claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    heartbeat_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_expires_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduler_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT REFERENCES scheduler_runs(id) ON DELETE CASCADE,
    task_run_id TEXT REFERENCES scheduler_task_runs(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    message TEXT,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scheduler_schedules_status_next
ON scheduler_schedules(status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_scheduler_schedules_owner
ON scheduler_schedules(owner_type, owner_id, status);

CREATE INDEX IF NOT EXISTS idx_scheduler_tasks_schedule_sequence
ON scheduler_tasks(schedule_id, enabled, sequence_no);

CREATE INDEX IF NOT EXISTS idx_scheduler_runs_schedule_status_started
ON scheduler_runs(schedule_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduler_runs_status_planned
ON scheduler_runs(status, planned_at);

CREATE INDEX IF NOT EXISTS idx_scheduler_runs_correlation
ON scheduler_runs(correlation_id);

CREATE INDEX IF NOT EXISTS idx_scheduler_task_runs_run_status
ON scheduler_task_runs(run_id, status, started_at);

CREATE INDEX IF NOT EXISTS idx_scheduler_claims_lease
ON scheduler_claims(lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_scheduler_events_run_created
ON scheduler_events(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduler_events_task_run_created
ON scheduler_events(task_run_id, created_at DESC);

-- ═══ Agent Logs ═══

CREATE TABLE IF NOT EXISTS agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT DEFAULT 'verbose',
    source TEXT,
    message TEXT NOT NULL,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ Communication Channels ═══

CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    channel_type TEXT NOT NULL,
    label TEXT NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    config_json TEXT NOT NULL,
    webhook_secret TEXT,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ Channel → User Mappings ═══

CREATE TABLE IF NOT EXISTS channel_user_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,           -- e.g., phone number, slack user ID
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, external_id)
);

-- ═══ User Permissions (admin-managed feature access) ═══

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    chat INTEGER DEFAULT 1,
    knowledge INTEGER DEFAULT 1,
    dashboard INTEGER DEFAULT 1,
    approvals INTEGER DEFAULT 1,
    mcp_servers INTEGER DEFAULT 1,
    channels INTEGER DEFAULT 0,
    llm_config INTEGER DEFAULT 0,
    screen_sharing INTEGER DEFAULT 1
);

-- ═══ Authentication Providers (admin-managed OAuth + Discord) ═══

CREATE TABLE IF NOT EXISTS auth_providers (
    id TEXT PRIMARY KEY,                -- 'azure-ad' | 'google' | 'discord'
    provider_type TEXT NOT NULL,         -- 'azure-ad' | 'google' | 'discord'
    label TEXT NOT NULL,
    client_id TEXT,
    client_secret TEXT,
    tenant_id TEXT,                      -- Azure AD only
    bot_token TEXT,                      -- Discord only
    application_id TEXT,                 -- Discord only
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ Custom Tools (agent-created extensibility) ═══

CREATE TABLE IF NOT EXISTS custom_tools (
    name TEXT PRIMARY KEY,              -- 'custom.tool_name'
    description TEXT NOT NULL,
    input_schema TEXT NOT NULL,          -- JSON Schema
    implementation TEXT NOT NULL,        -- TypeScript/JS code
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ API Keys (bearer-token auth for mobile / external clients) ═══

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,                        -- UUID
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                          -- human-readable label
    key_hash TEXT NOT NULL,                      -- SHA-256 hash of the raw key
    key_prefix TEXT NOT NULL,                    -- first 8 chars for identification (e.g. 'nxk_abc1')
    scopes TEXT NOT NULL DEFAULT '["chat"]',     -- JSON array of granted scopes
    expires_at DATETIME,                         -- NULL = never expires
    last_used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

-- ═══ Performance Indexes ═══

CREATE INDEX IF NOT EXISTS idx_threads_user_id ON threads(user_id);
CREATE INDEX IF NOT EXISTS idx_threads_last_message ON threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_attachments_thread_id ON attachments(thread_id);
CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_approval_queue_status ON approval_queue(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_queue_thread ON approval_queue(thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channels_user_id ON channels(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_id ON mcp_servers(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_user_mappings_channel ON channel_user_mappings(channel_id);
`;
