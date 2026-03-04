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
    source_context TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_knowledge_unique
    ON user_knowledge(user_id, entity, attribute, value);

CREATE TABLE IF NOT EXISTS knowledge_embeddings (
    knowledge_id INTEGER PRIMARY KEY REFERENCES user_knowledge(id) ON DELETE CASCADE,
    embedding TEXT NOT NULL
);

-- ═══ Threads (per-user) ═══

CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
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
    is_proactive_enabled BOOLEAN DEFAULT 0,
    scope TEXT DEFAULT 'global'          -- 'global' | 'user'
);

CREATE TABLE IF NOT EXISTS approval_queue (
    id TEXT PRIMARY KEY,
    thread_id TEXT REFERENCES threads(id),
    tool_name TEXT,
    args TEXT,
    reasoning TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
