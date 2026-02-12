export const SCHEMA_SQL = `
-- ═══ Identity & Configuration ═══

CREATE TABLE IF NOT EXISTS identity_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    owner_email TEXT NOT NULL,
    provider_id TEXT NOT NULL,          -- 'azure-ad' | 'google'
    external_sub_id TEXT UNIQUE,        -- OIDC Subject ID
    api_keys_encrypted TEXT             -- JSON blob of encrypted keys
);

CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport_type TEXT,                -- 'stdio' | 'sse'
    command TEXT NOT NULL,              -- e.g., 'npx'
    args TEXT,                          -- JSON array string
    env_vars TEXT                       -- JSON object string
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
    tool_results TEXT                   -- JSON blob of tool outputs
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
`;
