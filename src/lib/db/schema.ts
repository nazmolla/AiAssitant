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
    theme TEXT DEFAULT 'ember',
    timezone TEXT DEFAULT '',
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
    attachments TEXT
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
    is_proactive_enabled BOOLEAN DEFAULT 0
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

-- ═══ Agent Logs ═══

CREATE TABLE IF NOT EXISTS agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT DEFAULT 'info',
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
`;
