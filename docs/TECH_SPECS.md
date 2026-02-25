# Nexus Agent — Technical Specifications

> Back to [README](../README.md) | [Architecture](ARCHITECTURE.md) | [Installation](INSTALLATION.md) | [Usage](USAGE.md)

---

## Technical Stack

| Layer | Component | Details |
|-------|-----------|---------|
| Runtime | Node.js | v20+ (LTS). Tested on x86 and ARM64 (Jetson Nano). |
| Language | TypeScript | v5.x, Strict Mode |
| Database | SQLite | `better-sqlite3` — zero-config, single-file persistence |
| Frontend | Next.js 14 | App Router, TailwindCSS, Radix UI primitives, screen sharing via getDisplayMedia |
| LLM SDKs | Native | `@azure/openai`, `openai`, `@anthropic-ai/sdk` |
| MCP | v1.26+ | Stdio, SSE, and Streamable HTTP transports |
| Discord | discord.js | Gateway bot with mentions, DMs, and slash commands |
| Auth | NextAuth v4 | Credentials (email + password) and OAuth (Azure AD, Google) |
| Browser | Playwright | Chromium headless/headful for automation |
| Design | Custom | dark theme with coral accent, glass effects |

---

## Database Schema (SQLite)

### A. Users & Configuration

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    provider_id TEXT NOT NULL,          -- 'local' | 'azure-ad' | 'google'
    external_sub_id TEXT,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
    enabled BOOLEAN DEFAULT 1,           -- disabled users cannot sign in
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_permissions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    can_knowledge BOOLEAN DEFAULT 1,
    can_chat BOOLEAN DEFAULT 1,
    can_mcp BOOLEAN DEFAULT 1,
    can_channels BOOLEAN DEFAULT 1,
    can_approvals BOOLEAN DEFAULT 1,
    can_settings BOOLEAN DEFAULT 1
);

CREATE TABLE user_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    display_name TEXT, title TEXT, bio TEXT, location TEXT, phone TEXT,
    email TEXT, website TEXT, linkedin TEXT, github TEXT, twitter TEXT,
    skills TEXT DEFAULT '[]', languages TEXT DEFAULT '[]', company TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport_type TEXT,                -- 'stdio' | 'sse' | 'streamable-http'
    command TEXT, args TEXT, env_vars TEXT, url TEXT,
    auth_type TEXT DEFAULT 'none',      -- 'none' | 'bearer' | 'oauth'
    access_token TEXT, client_id TEXT, client_secret TEXT,
    user_id TEXT REFERENCES users(id),  -- NULL = global
    scope TEXT DEFAULT 'global'         -- 'global' | 'user'
);

CREATE TABLE llm_providers (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    provider_type TEXT NOT NULL,         -- 'azure-openai' | 'openai' | 'anthropic'
    purpose TEXT NOT NULL DEFAULT 'chat',-- 'chat' | 'embeddings'
    config_json TEXT NOT NULL,
    is_default BOOLEAN DEFAULT 0
);

CREATE TABLE auth_providers (
    id TEXT PRIMARY KEY,
    provider_type TEXT NOT NULL,         -- 'azure-ad' | 'google' | 'discord'
    label TEXT NOT NULL,
    client_id TEXT,
    client_secret TEXT,
    tenant_id TEXT,
    bot_token TEXT,
    application_id TEXT,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### B. Knowledge & Memory (Per-User)

```sql
CREATE TABLE user_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT REFERENCES users(id),
    entity TEXT NOT NULL,
    attribute TEXT NOT NULL,
    value TEXT NOT NULL,
    source_context TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Unique index: (user_id, entity, attribute, value)

CREATE TABLE knowledge_embeddings (
    knowledge_id INTEGER PRIMARY KEY REFERENCES user_knowledge(id),
    embedding TEXT NOT NULL              -- JSON float array
);
```

### C. Threads & Messages (Per-User)

```sql
CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    title TEXT,
    status TEXT DEFAULT 'active',
    last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT REFERENCES threads(id),
    role TEXT CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT,
    tool_calls TEXT,
    tool_results TEXT,
    attachments TEXT
);

CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    thread_id TEXT REFERENCES threads(id),
    message_id INTEGER REFERENCES messages(id),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL
);
```

### D. Safety & Policies

```sql
CREATE TABLE tool_policies (
    tool_name TEXT PRIMARY KEY,
    mcp_id TEXT REFERENCES mcp_servers(id),
    requires_approval BOOLEAN DEFAULT 1,
    is_proactive_enabled BOOLEAN DEFAULT 0
);

CREATE TABLE approval_queue (
    id TEXT PRIMARY KEY,
    thread_id TEXT REFERENCES threads(id),
    tool_name TEXT, args TEXT, reasoning TEXT,
    status TEXT DEFAULT 'pending',       -- 'pending' | 'approved' | 'rejected'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### E. Communication Channels

```sql
CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    channel_type TEXT NOT NULL,          -- 'whatsapp' | 'discord' | 'webhook'
    label TEXT NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    config_json TEXT NOT NULL,
    webhook_secret TEXT,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE  -- channel owner
);

CREATE TABLE channel_user_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT REFERENCES channels(id),
    external_id TEXT NOT NULL,           -- phone number, Slack user ID, etc.
    user_id TEXT REFERENCES users(id),
    UNIQUE(channel_id, external_id)
);
```

---

## API Routes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET/POST` | `/api/threads` | User | List/create threads (user-scoped) |
| `GET/DELETE` | `/api/threads/[threadId]` | User | Get/delete thread (ownership enforced) |
| `POST` | `/api/threads/[threadId]/chat` | User | Send message and run agent loop |
| `GET/POST` | `/api/knowledge` | User | List/upsert knowledge entries (user-scoped) |
| `GET/POST` | `/api/mcp` | User | List/add MCP servers (global + user-scoped) |
| `POST` | `/api/mcp/[serverId]/connect` | Auth | Connect to an MCP server |
| `GET` | `/api/mcp/tools` | Auth | List all available MCP tools |
| `GET/POST` | `/api/approvals` | Auth | List/resolve pending approvals |
| `GET/POST` | `/api/policies` | Auth | List/update tool policies |
| `GET` | `/api/logs` | Auth | Fetch agent activity logs |
| `GET/POST` | `/api/config/llm` | Auth | Manage LLM provider configs |
| `GET/POST/PATCH/DELETE` | `/api/config/auth` | Admin | Manage OAuth and Discord auth providers |
| `GET/POST/PATCH/DELETE` | `/api/config/channels` | User | Manage communication channels (user-scoped, ownership enforced) |
| `GET/PUT` | `/api/config/profile` | User | Get/update user profile (user-scoped) |
| `POST` | `/api/channels/[channelId]/webhook` | Webhook | Receive inbound messages from channels |
| `POST` | `/api/attachments` | User | Upload file attachments |
| `GET` | `/api/attachments/[...path]` | Auth | Serve uploaded files |
| `GET/POST` | `/api/mcp/[serverId]/oauth/*` | Auth | OAuth authorize/callback for MCP servers |
| `GET` | `/api/admin/users` | Admin | List all users with permissions |
| `PUT/DELETE` | `/api/admin/users` | Admin | Update user role/status or delete user |
| `GET` | `/api/admin/users/me` | User | Get current user's role and permissions |

---

## Security

### Static Analysis Fixes

Comprehensive static code scan identified and patched the following:

| Category | Fix | Files |
|----------|-----|-------|
| **Path Traversal** | `resolvePath()` uses `realpathSync()` to resolve symlinks before checking against allowed root | `fs-tools.ts` |
| **Command Injection** | `fsExecuteScript()` blocks catastrophic patterns (`rm -rf /`, `dd`, `curl\|sh`, etc.) | `fs-tools.ts` |
| **SQL Injection** | `updateUserPermissions()` uses `Set.has()` whitelist for dynamic column names | `queries.ts` |
| **Header Injection** | Attachment `Content-Disposition` filename sanitized, `X-Content-Type-Options: nosniff` added | `attachments/[...path]/route.ts` |
| **Error Info Leakage** | Internal file paths stripped from error messages in connect, chat, and webhook routes | `connect/route.ts`, `chat/route.ts`, `webhook/route.ts` |
| **Input Validation** | Channel label length + config type validation; profile field length limits with `sanitizeField()` | `channels/route.ts`, `profile/route.ts` |
| **UUID Validation** | Admin user management validates `userId` against UUID regex before DB operations | `admin/users/route.ts` |

### Prompt Injection Defense

Multi-layered defense against prompt injection across all input vectors:

| Layer | Defense | Location |
|-------|---------|----------|
| **System Prompt Hardening** | Anti-injection rules instruct the LLM to never follow instructions found in tool results, knowledge entries, or external messages | `loop.ts` |
| **Untrusted Content Tagging** | Tool results from web/browser tools wrapped in `<untrusted_external_content>` XML tags | `loop.ts` |
| **Knowledge Vault Isolation** | Knowledge context delimited with `<knowledge_context type="user_data">` trust boundary; entries marked as DATA, not instructions | `loop.ts` |
| **Knowledge Entry Validation** | `looksLikeInjection()` scans for 14 injection patterns and blocks suspicious entries from being stored | `knowledge/index.ts` |
| **Knowledge Extraction Hardening** | User text wrapped in `<document>` tags; extraction prompt instructs LLM to ignore directives within documents | `knowledge/index.ts` |
| **Vault Poisoning Prevention** | Web/browser tool results excluded from knowledge ingestion pipeline | `loop.ts` |
| **External Message Tagging** | Discord and webhook messages tagged with `[External Channel Message from ...]` origin marker | `discord.ts`, `webhook/route.ts` |
| **Historical Context Re-tagging** | Tool results reconstructed from DB history re-tagged as untrusted | `loop.ts` |

### HTTP Security Headers

| Header/Feature | Value |
|----------------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Powered-By` | Removed (disabled via `poweredByHeader: false`) |

### Rate Limiting

IP-based sliding-window rate limiter in middleware:
- **120 requests/minute** per IP on all protected API routes
- Returns `429 Too Many Requests` with `Retry-After: 60` header when exceeded
- Stale entries auto-cleaned every 5 minutes

### Authentication Responses

- Protected API routes return **`401 JSON`** (`{"error":"Authentication required"}`) for unauthenticated requests
- Previously returned `200` with sign-in page HTML, which confused API consumers and masked the auth requirement

### Verified Secure (Dynamic Scan)

| Test | Result |
|------|--------|
| CORS origin reflection | No `Access-Control-Allow-Origin` reflected for any origin |
| Path traversal (`../../etc/passwd`) | Blocked — 404 |
| Sensitive files (`.env`, `.git`, `nexus.db`) | All return 404 |
| XSS reflection | Not reflected |
| Source maps | Not exposed |
| Data exposure without auth | No real data leaks — all routes return 401 |
