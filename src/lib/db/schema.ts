export const SCHEMA_SQL = `
-- ═══ Identity & Configuration ═══

CREATE TABLE IF NOT EXISTS identity_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    owner_email TEXT NOT NULL,
    provider_id TEXT NOT NULL,          -- 'azure-ad' | 'google'
    external_sub_id TEXT UNIQUE,        -- OIDC Subject ID
    password_hash TEXT,                 -- bcrypt hash for local owner auth
    api_keys_encrypted TEXT             -- JSON blob of encrypted keys
);

CREATE TABLE IF NOT EXISTS owner_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    display_name TEXT NOT NULL DEFAULT '',
    title TEXT DEFAULT '',              -- e.g., 'Senior Software Engineer'
    bio TEXT DEFAULT '',                -- short summary
    location TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    website TEXT DEFAULT '',
    linkedin TEXT DEFAULT '',
    github TEXT DEFAULT '',
    twitter TEXT DEFAULT '',
    skills TEXT DEFAULT '[]',           -- JSON array of strings
    languages TEXT DEFAULT '[]',        -- JSON array of strings
    company TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport_type TEXT,                -- 'stdio' | 'sse'
    command TEXT NOT NULL,              -- e.g., 'npx'
    args TEXT,                          -- JSON array string
    env_vars TEXT                       -- JSON object string
);

CREATE TABLE IF NOT EXISTS llm_providers (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    provider_type TEXT NOT NULL,        -- 'azure-openai' | 'openai' | 'anthropic'
    purpose TEXT NOT NULL DEFAULT 'chat', -- 'chat' | 'embedding'
    config_json TEXT NOT NULL,          -- Provider-specific credentials/config
    is_default BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ Memory & Knowledge ═══

CREATE TABLE IF NOT EXISTS user_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT NOT NULL,               -- e.g., 'Project X'
    attribute TEXT NOT NULL,            -- e.g., 'Preferred Tech'
    value TEXT NOT NULL,                -- e.g., 'Azure AI'
    source_context TEXT,                -- Snippet of conversation where fact was learned
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_knowledge_unique
    ON user_knowledge(entity, attribute, value);

CREATE TABLE IF NOT EXISTS knowledge_embeddings (
    knowledge_id INTEGER PRIMARY KEY REFERENCES user_knowledge(id) ON DELETE CASCADE,
    embedding TEXT NOT NULL              -- JSON array of floats
);

CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,                -- UUID
    title TEXT,
    status TEXT DEFAULT 'active',       -- 'active' | 'awaiting_approval' | 'archived'
    last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT REFERENCES threads(id),
    role TEXT CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT,
    tool_calls TEXT,                    -- JSON blob of tool requests
    tool_results TEXT,                  -- JSON blob of tool outputs
    attachments TEXT                    -- JSON array of attachment metadata
);

CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,                -- UUID
    thread_id TEXT REFERENCES threads(id),
    message_id INTEGER REFERENCES messages(id),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,         -- relative path under data/attachments/
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ Safety & Proactive Actions ═══

CREATE TABLE IF NOT EXISTS tool_policies (
    tool_name TEXT PRIMARY KEY,         -- e.g., 'github.create_issue'
    mcp_id TEXT REFERENCES mcp_servers(id),
    requires_approval BOOLEAN DEFAULT 1,
    is_proactive_enabled BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS approval_queue (
    id TEXT PRIMARY KEY,
    thread_id TEXT REFERENCES threads(id),
    tool_name TEXT,
    args TEXT,                          -- JSON arguments
    reasoning TEXT,                     -- LLM's explanation for the action
    status TEXT DEFAULT 'pending',      -- 'pending' | 'approved' | 'rejected'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ Agent Logs ═══

CREATE TABLE IF NOT EXISTS agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT DEFAULT 'info',          -- 'info' | 'warn' | 'error' | 'thought'
    source TEXT,                        -- 'scheduler' | 'agent' | 'mcp' | 'hitl'
    message TEXT NOT NULL,
    metadata TEXT,                      -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══ Communication Channels ═══

CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,                -- UUID
    channel_type TEXT NOT NULL,         -- 'whatsapp' | 'slack' | 'email' | 'telegram' | 'discord' | 'teams'
    label TEXT NOT NULL,                -- user-friendly name
    enabled BOOLEAN DEFAULT 1,
    config_json TEXT NOT NULL,          -- channel-specific credentials/config
    webhook_secret TEXT,                -- secret for verifying inbound webhooks
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;
