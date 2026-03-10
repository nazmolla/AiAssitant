# Nexus Agent — Technical Specifications

> Back to [README](../README.md) | [Architecture](ARCHITECTURE.md) | [Installation](INSTALLATION.md) | [Usage](USAGE.md)

---

## Technical Stack

| Layer | Component | Details |
|-------|-----------|---------|
| Runtime | Node.js | v20+ (LTS). Tested on x86-64 and ARM64. |
| Language | TypeScript | v5.x, Strict Mode |
| Database | SQLite | `better-sqlite3` — zero-config, single-file persistence. **Application cache** (`src/lib/cache.ts`) — in-memory write-through cache with 60s TTL and explicit invalidation for LLM providers, tool policies, user records, profiles, auth lookups (by-email/by-sub with 5-min TTL), channels, auth providers, and MCP servers (decrypted, per-user where applicable) to avoid redundant synchronous DB queries on every request. **Provider instance cache** (`src/lib/llm/orchestrator.ts`) — module-level Map keyed by config hash with 10s TTL; avoids re-constructing SDK clients on every chat request. **Embedding result cache** (`src/lib/llm/embeddings.ts`) — LRU Map keyed by SHA-256 text hash with 1-hour TTL, max 500 entries; eliminates redundant embedding API calls (100-500 ms each). |
| Knowledge Hygiene | Normalized dedupe | `upsertKnowledge()` performs normalized (case/whitespace-insensitive) merge checks before insert, and startup migration deduplicates legacy normalized duplicates in `user_knowledge`. Ingestion also dedupes extracted facts per turn and caps noisy `source_context` length to reduce DB growth. |
| Frontend | Next.js 16 | App Router, Material UI (MUI v7) with 7 color themes, TailwindCSS, screen sharing via getDisplayMedia, **Markdown rendering** via `react-markdown` + `remark-gfm`, **virtualized message list** via `@tanstack/react-virtual` (windowed rendering, dynamic measurement, overscan buffer), header avatar/name with direct Profile access plus dedicated Sign out button. **Middleware proxy** limit set to `50 MB` (`proxyClientMaxBodySize`) for large file uploads. Build requires `--webpack` flag (Turbopack unsupported). |
| HTTPS | nginx + self-signed cert | Reverse proxy HTTPS:443 → Next.js:3000. Required for mic access over network. TLSv1.2/1.3, HTTP → HTTPS redirect, SSE passthrough. |
| Audio | OpenAI Whisper + TTS-1 | Speech-to-Text (mic input, 25 MB max, webm/wav/mp3/ogg/flac) and Text-to-Speech (9 voices, configurable output format: mp3/wav/pcm/opus/aac/flac). Supports dedicated `tts` and `stt` purpose providers with standard deployment field for Azure OpenAI. **Local Whisper fallback** — optional local Whisper server (faster-whisper-server or whisper.cpp) as automatic backup when cloud STT fails. **Audio mode** — hands-free conversation with auto-listen and streaming TTS. **Conversation Mode** — dedicated `/conversation` tab with VAD-based automatic speech endpoint detection (WebAudio AnalyserNode, 1.2 s silence / 0.4 s min speech), lightweight `/api/conversation/respond` endpoint (full tool support, no knowledge/profile/DB overhead), in-memory client-side history (30 msg cap), real-time audio level visualization, atomic `stateRef` sync via `useCallback`, auto-listen after response, and **interrupt / barge-in** (separate interrupt VAD with 200 ms sustained speech at 2× threshold triggers abort of LLM + TTS, marks transcript with ⸺, transitions to listening). **ESP32 Atom Echo** — standalone Arduino sketch for M5Stack Atom Echo with on-device wake-word detection via micro-wake-up, WAV-format TTS, full tool support via `/api/conversation/respond`. |
| LLM SDKs | Native | `@azure/openai`, `openai`, `@anthropic-ai/sdk`, LiteLLM proxy. **Streaming responses** — tokens are streamed in real-time via SSE `token` events for instant perceived latency. SSE writes use a `sseSend()` safety wrapper with `streamCancelled` flag to prevent crashes when clients disconnect mid-stream. **Worker Thread isolation** — LLM API calls run in a dedicated Node.js Worker Thread (`scripts/agent-worker.js`) to prevent token streaming from blocking the main event loop. Tool execution, DB access, and knowledge retrieval remain on the main thread with IPC-based coordination. Automatic fallback to main thread if worker is unavailable. **No-thinking control** — chat providers can persist `disableThinking` in provider config; OpenAI-compatible paths send `think=false` with fallback retry when unsupported. |
| Agent Workflows | Built-in tool orchestration | The system prompt includes a guided job-scout workflow: web discovery of matching roles (including LinkedIn links), per-role tailored resume generation via `builtin.file_generate`, and delivery by `builtin.email_send` with attachments. |
| MCP | v1.26+ | Stdio, SSE, and Streamable HTTP transports. `list_changed` auto-refresh (500 ms debounce). |
| Discord | discord.js | Gateway bot with mentions, DMs, and slash commands |
| Auth | NextAuth v4 | Credentials (email + password) and OAuth (Azure AD, Google) |
| Browser | Playwright | Chromium headless/headful for automation |
| Design | Material Design | 7 switchable dark themes (Ember, Midnight, Frost, Sunrise, Forest, Amethyst, Obsidian), Google Roboto font |

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
    screen_sharing_enabled INTEGER DEFAULT 1,
    notification_level TEXT DEFAULT 'disaster',
    theme TEXT DEFAULT 'ember', font TEXT DEFAULT 'inter',
    timezone TEXT DEFAULT '', tts_voice TEXT DEFAULT 'nova',
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
    purpose TEXT NOT NULL DEFAULT 'chat',-- 'chat' | 'embedding' | 'tts' | 'stt'
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
    source_type TEXT NOT NULL DEFAULT 'manual', -- manual | chat | proactive
    source_context TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Unique index: (user_id, entity, attribute, value)
-- Performance indexes: (user_id), (user_id, entity), (user_id, attribute)

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
    thread_type TEXT NOT NULL DEFAULT 'interactive', -- interactive | proactive | scheduled | channel
    is_interactive INTEGER NOT NULL DEFAULT 1,
    channel_id TEXT,
    external_sender_id TEXT,
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
    attachments TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    scope TEXT DEFAULT 'global'         -- 'global' (all users) | 'user' (admin only)
);

CREATE TABLE approval_queue (
    id TEXT PRIMARY KEY,
    thread_id TEXT REFERENCES threads(id),  -- NULL for proactive (scheduler) approvals
    tool_name TEXT, args TEXT, reasoning TEXT,
    nl_request TEXT,                     -- Human-readable summary of the request
    source TEXT DEFAULT 'chat',          -- source tag (examples: 'chat', 'proactive', 'proactive:scheduler', 'email:<sender>')
    status TEXT DEFAULT 'pending',       -- 'pending' | 'approved' | 'rejected'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,                  -- 'approval_required' | 'tool_error' | 'proactive_action' | 'channel_error' | 'system_error' | 'info'
    title TEXT NOT NULL,
    body TEXT,
    metadata TEXT,                       -- JSON blob for extra context
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notifications_user_read ON notifications (user_id, read);
CREATE INDEX idx_notifications_created ON notifications (created_at);

CREATE TABLE scheduled_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
    task_name TEXT NOT NULL,
    frequency TEXT NOT NULL DEFAULT 'once', -- once | hourly | daily | weekly | monthly
    interval_value INTEGER NOT NULL DEFAULT 1,
    next_run_at DATETIME NOT NULL,
    last_run_at DATETIME,
    run_count INTEGER NOT NULL DEFAULT 0,
    scope TEXT NOT NULL DEFAULT 'user',     -- user | global
    source TEXT NOT NULL DEFAULT 'user_request', -- user_request | proactive
    task_payload TEXT NOT NULL,             -- JSON action payload
    status TEXT NOT NULL DEFAULT 'active',  -- active | paused | completed | failed
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_scheduled_tasks_due ON scheduled_tasks (status, next_run_at);
```

> **Notifications**: The `notifications` table stores persistent in-app notifications surfaced via the bell icon in the header. Notifications are automatically created when `notifyAdmin()` is called. Types include approval requests, tool errors, proactive actions, channel errors, and system-level alerts.
>
> **Proactive approvals**: When `thread_id` is `NULL`, the approval was created by the proactive scheduler (no associated chat thread). These appear in the Notification Center for admins and are executed directly when approved — no agent loop continuation is needed.
>
> **Typed thread filtering**: User chat thread lists now filter by `threads.thread_type = 'interactive'` (and `is_interactive = 1`) instead of title-prefix matching (e.g. `[proactive-scan]`, `[scheduled]`, `channel:*`). Channel conversations are resolved using `channel_id` + `external_sender_id` columns.
>
> **Typed knowledge source filtering**: Knowledge entries use `user_knowledge.source_type` (`manual` / `chat` / `proactive`) for filtering and reporting, replacing source-context prefix parsing.
>
> **Scheduled Tasks**: User future/recurring requests and proactive-discovered actions are persisted in `scheduled_tasks`. During each background scheduler cycle, due tasks (`next_run_at <= now`) are executed, `last_run_at` / `run_count` are updated, and `next_run_at` is recalculated from `frequency` + `interval_value`.
>
> **Severity capping**: Smart home / IoT tool assessments (prefixes: `builtin.alexa_`, `builtin.smart_home_`, `builtin.iot_`, `builtin.hue_`, `builtin.nest_`, `builtin.ring_`) are automatically capped at `high` severity — they can never produce `disaster`-level events.
>
> **Quiet hours** (10 PM – 8 AM): Audio-producing tools are blocked during nighttime. This includes announcements, media playback, TTS, and volume increases. Volume decreases/muting and read-only queries remain allowed. The enforcement is in `executeSchedulerTool()` and applies to all scheduler-initiated actions (proactive and scheduled tasks).

### E. Custom Tools (Self-Extending)

```sql
CREATE TABLE custom_tools (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    input_schema TEXT NOT NULL,          -- JSON schema (type: "object")
    implementation TEXT NOT NULL,        -- JavaScript function body
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### F. Communication Channels

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

### G. App Configuration (Key-Value)

The `app_config` table stores application-wide settings as key-value pairs. Sensitive values are encrypted with AES-256-GCM.

| Key | Description | Encrypted |
|-----|-------------|:-:|
| `alexa.ubid_main` | Amazon Alexa UBID_MAIN cookie | ✅ |
| `alexa.at_main` | Amazon Alexa AT_MAIN cookie | ✅ |
| `log_level_min` | Minimum log severity level to persist | ❌ |
| `proactive_cron_schedule` | Cron expression for proactive scheduler interval (default: `*/15 * * * *`) | ❌ |
| `knowledge_maintenance_enabled` | Enable/disable nightly knowledge maintenance worker (`1`/`0`) | ❌ |
| `knowledge_maintenance_hour` | Local-hour daily run time for nightly knowledge maintenance (0-23) | ❌ |
| `knowledge_maintenance_minute` | Local-minute daily run time for nightly knowledge maintenance (0-59) | ❌ |
| `knowledge_maintenance_poll_seconds` | Worker poll cadence in seconds (30-300) | ❌ |
| `knowledge_maintenance_last_run_date` | Last local date (`YYYY-MM-DD`) when nightly knowledge maintenance completed | ❌ |
| `knowledge_maintenance_last_run_at` | ISO timestamp of last completed nightly knowledge maintenance run | ❌ |

---

## API Routes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET/POST` | `/api/threads` | User | List/create threads (user-scoped); GET supports `?limit=N&offset=M` pagination (default 50, max 200) returning `{ data, total, limit, offset, hasMore }` |
| `GET/DELETE` | `/api/threads/[threadId]` | User | Get/delete thread (ownership enforced) |
| `POST` | `/api/threads/[threadId]/chat` | User | Send message and run agent loop (SSE streaming: `token`, `status`, `message`, `done`, `error` events) |
| `GET/POST` | `/api/knowledge` | User | List/upsert knowledge entries (user-scoped); GET supports `?limit=N&offset=M` pagination (default 100, max 500) returning `{ data, total, limit, offset, hasMore }` |
| `GET/POST` | `/api/mcp` | User | List/add MCP servers (global + user-scoped) |
| `POST` | `/api/mcp/[serverId]/connect` | Auth | Connect to an MCP server |
| `GET` | `/api/mcp/tools` | Auth | List all available MCP tools |
| `GET/POST` | `/api/approvals` | Auth | List/resolve pending approvals (O(1) JOIN query; stale approvals auto-cleaned) |
| `GET/POST` | `/api/policies` | Auth | List/update tool policies |
| `GET` | `/api/logs` | Auth | Fetch agent activity logs (admin session or API key with `logs` scope) |
| `GET` | `/api/logs/stream` | Auth | Stream live logs over SSE (`log`, `cursor`, `heartbeat`) |
| `GET/PUT/POST` | `/api/config/db-management` | Admin | Get DB/resource snapshot, update recurring cleanup policy, or run cleanup immediately |
| `GET/PUT/DELETE` | `/api/config/standing-orders` | User | List, update, or delete saved approval preferences (standing orders) |
| `GET/POST` | `/api/config/llm` | Auth | Manage LLM provider configs |
| `GET/POST/PATCH/DELETE` | `/api/config/auth` | Admin | Manage OAuth and Discord auth providers |
| `GET/POST/PATCH/DELETE` | `/api/config/channels` | User | Manage communication channels (user-scoped, ownership enforced) |
| `GET/PUT` | `/api/config/profile` | User | Get/update user profile (user-scoped) |
| `GET/PUT` | `/api/config/alexa` | Admin | Get masked / store encrypted Alexa Smart Home credentials |
| `GET/POST/PUT/DELETE` | `/api/config/custom-tools` | Admin | Manage agent-created custom tools |
| `POST` | `/api/channels/[channelId]/webhook` | Webhook | Receive inbound messages from channels |
| `POST` | `/api/attachments` | User | Upload file attachments |
| `GET` | `/api/attachments/[...path]` | Auth | Serve uploaded files |
| `GET/POST` | `/api/mcp/[serverId]/oauth/*` | Auth | OAuth authorize/callback for MCP servers |
| `POST` | `/api/audio/transcribe` | User | Speech-to-Text via Whisper (multipart/form-data audio, max 25 MB) |
| `POST` | `/api/audio/tts` | User | Text-to-Speech via TTS-1 (JSON `{text, voice?}`, returns MP3 binary) |
| `POST` | `/api/audio/tts-stream` | User | Streaming-friendly TTS endpoint for audio mode (no-cache headers) |
| `GET/PUT` | `/api/config/whisper` | Admin | Get/update local Whisper server configuration |
| `POST` | `/api/config/whisper` | Admin | Test connectivity to local Whisper server |
| `GET/PUT` | `/api/config/scheduler` | Admin | Get/update proactive scheduler cron schedule (stored in `app_config`) |
| `GET` | `/api/admin/users` | Admin | List all users with permissions |
| `PUT/DELETE` | `/api/admin/users` | Admin | Update user role/status or delete user |
| `GET` | `/api/admin/users/me` | User | Get current user's role and permissions |
| `POST` | `/api/conversation/respond` | User | Lightweight LLM endpoint for voice conversation with full tool support (SSE streaming: `token`, `tool_call`, `tool_result`, `done`, `error` events). Skips knowledge retrieval, profile context, and DB persistence for fast response. |

---

## Tool Dispatch & Name Normalization

All built-in tools use the `builtin.` prefix (e.g. `builtin.alexa_announce`, `builtin.browser_navigate`). MCP tools use `serverId.toolName` format.

**Tool name length enforcement**: The OpenAI API enforces a maximum of **64 characters** for tool `function.name`. MCP tool names are qualified as `serverId.toolName` where `serverId` is a UUID (36 chars) + dot = 37-char prefix, leaving 27 characters for the tool name. The `qualifyToolName()` function in `manager.ts` truncates the tool-name portion when the combined name exceeds 64 characters, and maintains a `toolNameMap` reverse mapping so `callTool()` can resolve the truncated name back to the original MCP tool name. Custom tools enforce the same 2–64 character limit at creation time.

**Tool array cap**: The OpenAI API enforces a maximum of **128 tools** per request. All dispatch paths (agent loop, conversation endpoint, worker) cap the total tools array at `MAX_TOOLS_PER_REQUEST = 128` — builtin and custom tools take priority, then MCP tools fill remaining slots.

**`multi_tool_use.parallel` expansion**: Some OpenAI models emit a synthetic `multi_tool_use.parallel` tool call instead of returning multiple separate `tool_calls` entries. The `expandMultiToolUse()` function in `discovery.ts` detects this pattern, extracts individual tool calls from the `tool_uses` array (stripping the `functions.` prefix from `recipient_name`), and generates individual `ToolCall` entries with sequential IDs. Applied in all dispatch paths: `loop.ts`, `conversation/respond`, and `agent-worker.js`.

**Dispatch chain** (identical in `loop.ts`, `gatekeeper.ts`, `scheduler/index.ts`):

`isBuiltinWebTool → isBrowserTool → isFsTool → isFileTool → isNetworkTool → isEmailTool → isAlexaTool → isCustomTool → MCP fallback`

**Name normalization**: The LLM sometimes strips the `builtin.` prefix when calling tools (e.g. `alexa_announce` instead of `builtin.alexa_announce`). The `normalizeToolName()` function in `discovery.ts` lazily builds a map of all known builtin short names and restores the prefix before dispatch. Applied in all three dispatch entry points.

**Discovery**: `discovery.ts` uses barrel exports from `agent/index.ts` (via `import * as agentExports from "./index"`) to dynamically discover all `BUILTIN_*_TOOLS` arrays and `*_REQUIRING_APPROVAL` arrays. To avoid circular dependencies, `discovery.ts` is **not** re-exported from the barrel — consumers import directly from `@/lib/agent/discovery`.

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
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=(), interest-cohort=()` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Powered-By` | Removed (disabled via `poweredByHeader: false`) |

### Rate Limiting

IP-based sliding-window rate limiter in middleware:
- **120 requests/minute** per IP on all protected API routes
- Returns `429 Too Many Requests` with `Retry-After: 60` header when exceeded
- Stale entries auto-cleaned every 5 minutes

**Middleware matcher** — routes covered by rate limiting + JWT auth:

```
/api/threads/*      /api/approvals/*    /api/knowledge/*
/api/mcp/*          /api/policies/*     /api/logs/*
/api/config/*       /api/attachments/*  /api/admin/*
/api/audio/*        /api/conversation/* /api/notifications
```

Routes **not** in the matcher (use their own auth):
- `/api/channels/[channelId]/webhook` — authenticates via webhook secret (`timingSafeEqual`)
- `/api/client-error` — intentionally unauthenticated (error boundary fires before session)
- `/api/auth/*` — NextAuth endpoints (handle their own auth flows)

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

---

## Attachment Processing & OOM Prevention

Large file attachments are size-gated before being passed to the LLM to prevent heap exhaustion on memory-constrained devices (e.g. ARM SBCs with ~1 GB available heap).

| Guard | Threshold | Behavior |
|-------|-----------|----------|
| Text inline limit | `MAX_INLINE_TEXT_BYTES` = **512 KB** | Files ≤ 512 KB are fully inlined. Larger files get a **2 KB preview** (read via file descriptor, not full `readFileSync`) plus a path reference for the agent's `fs_read_file` tool. |
| Image inline limit | `MAX_INLINE_IMAGE_BYTES` = **5 MB** | Images ≤ 5 MB are base64-inlined. Larger images are referenced by path only. |
| Middleware proxy | `proxyClientMaxBodySize` = **50 MB** | Next.js middleware body size limit raised from the default 10 MB to support large file uploads. |
| Text MIME types | `TEXT_MIME_TYPES` set | `text/plain`, `text/csv`, `text/markdown`, `text/html`, `text/xml`, `application/json`, `application/xml`, `image/svg+xml` |

**Files**: `src/app/api/threads/[threadId]/chat/route.ts`, `next.config.mjs`

---

## Knowledge Retrieval Optimization

Knowledge retrieval is gated to avoid unnecessary API calls and latency:

1. **Empty vault skip** — `hasKnowledgeEntries(userId)` checks the in-memory embedding cache (300s TTL, SQLite-backed). If the user has no knowledge entries, retrieval is skipped entirely — no status event, no embedding API call.
2. **Cache-first semantic search** — `semanticSearch()` loads cached embeddings **before** calling `generateEmbedding()`. If the cache is empty, the expensive embedding API call is skipped.
3. **Minimum similarity threshold** — `MIN_SIMILARITY = 0.25` filters out low-relevance matches (e.g. "hello" vs. random knowledge entries).
4. **Keyword fallback** — If semantic search returns fewer than the requested limit, keyword-based `LIKE` search fills the remaining slots.

**Files**: `src/lib/knowledge/retriever.ts`, `src/lib/agent/loop.ts`, `src/lib/agent/loop-worker.ts`

---

## Deployment

Production deployment targets a remote Linux host via SSH.

| Step | Command | Details |
|------|---------|--------|
| Build | `npx next build --webpack` | Turbopack is not supported (fails with `worker_threads` error). Webpack bundler required. |
| Deploy | `bash deploy.sh <host> <user>` | Automated: version bump → tests → build → tarball (DB excluded) → remote DB backup → upload → extract → npm install → restart → health check |
| Verify | `curl -sk https://<host>` | HTTP 200 confirms service is running |
| Logs | `journalctl -u nexus-agent` | systemd service logs |

**Deploy script design** (`deploy.sh`):
- Each remote operation is a **discrete SSH call** (no multi-line heredocs) for Windows PowerShell compatibility
- SSH stderr warnings (post-quantum key exchange) are silenced via `-o LogLevel=ERROR` + `2>/dev/null`
- Tarball is gzip-compressed and uploaded to `/tmp/` then extracted
- Production database `nexus.db` is **never** overwritten — excluded from tarball and protected via `chmod 444` guard during extraction

---

## Dashboard Analytics Computation

The analytics dashboard (`src/components/agent-dashboard.tsx`) computes operational metrics from `/api/logs` data entirely in the client layer.

### Inputs

- Source API: `GET /api/logs?limit=all&level=all&source=all`
- Date range: `startDate` / `endDate` controls applied in-memory
- Session key inference from metadata JSON fields:
    - `sessionId`, `session_id`, `threadId`, `thread_id`, `conversationId`, `conversation_id`, `chatId`, `chat_id`, `run_id`

### Derived KPIs

- **Sessions**: unique inferred session keys in date range
- **Engagement rate**: sessions with >= 3 events or agent/thought activity
- **Resolution / Escalation / Abandon rates**: inferred by outcome classification over session logs
- **CSAT proxy**: bounded score in range `[1,5]` derived from session outcomes

### Charts and Drilldown

- **Errors & Activities chart**: 8 time buckets over selected date range
- **Sessions chart**: unique session counts per bucket
- **Session outcomes chart**: resolved/escalated/abandoned per bucket
- Bucket click applies drilldown filter to the existing detail stream (log explorer)

### Driver Tables

Three topic-level driver tables are computed from inferred topics and outcomes:

- Resolution rate drivers
- Escalation rate drivers
- Abandon rate drivers

Each row reports topic rate and delta impact against overall rate.

---

## Testing

### Framework

| Tool | Purpose |
|------|---------|
| Jest | Test runner with 3 projects: `unit` (node), `integration` (node), `component` (jsdom) |
| @testing-library/react | Component rendering and DOM assertions |
| ts-jest | TypeScript transform for all test files |

### Coverage

**1276 tests across 98 suites** — all passing.

| Category | Suites | Description |
|----------|--------|-------------|
| Unit | ~65 | Agent loop, gatekeeper, discovery, orchestrator, DB queries, API routes, auth guards, knowledge retrieval, inbound email classification, attachment size guards, embedding cache, provider cache, auth cache, decrypted row cache, vault embedding cache, ChatPanel split verification |
| Integration | ~6 | End-to-end API flows, MCP integration, channel routing, SSE concurrency & disconnect safety |
| Component | ~10 | Full navigation (every page + settings sub-page), component rendering, settings panel, tool policies, profile config, markdown rendering, TTS-to-listening transitions, interrupt / barge-in |

### Component Test Architecture

Component tests use `jsdom` environment with the following mocks:

- **`next/navigation`** — `useRouter` (push/back), `usePathname`, `useSearchParams`
- **`next-auth/react`** — `useSession` returns authenticated admin session
- **`next/dynamic`** — Replaced with `React.lazy` + `Suspense` for synchronous rendering
- **`theme-provider`** — No-op `useThemeContext` returning default theme state
- **`fetch`** — Global mock returning permission-appropriate JSON responses
- **Browser APIs** — `matchMedia`, `IntersectionObserver`, `ResizeObserver` polyfills, `TextEncoder`/`TextDecoder` from Node `util`

### Key Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/component/full-navigation.test.tsx` | 65 | All 6 main tabs, all 11 settings pages (via chips and URL routing), loading-state guards, permission gating, admin-only visibility, UI elements, redirects |
| `tests/component/component-render.test.tsx` | 20 | Render + content verification for all settings components (LlmConfig, ChannelsConfig, AuthConfig, UserManagement, CustomToolsConfig, LoggingConfig, WhisperConfig, ApprovalInbox, KnowledgeVault, ApiKeysConfig) |
| `tests/component/page.test.tsx` | 17 | Core page rendering, tab switching, drawer navigation |
| `tests/component/settings-panel.test.tsx` | 4 | Settings chip selection, visibility |
| `tests/component/conversation-tts-transition.test.tsx` | 6 | TTS → listening/idle transition, auto-listen toggle, no stuck speaking state, TTS error recovery, timing |
| `tests/component/conversation-interrupt.test.tsx` | 8 | Interrupt during speaking/thinking, ⸺ transcript marker, brief-noise rejection, no interrupt in idle/listening, stopEverything cleanup, full cycle after interrupt |
| `tests/integration/api/sse-concurrency.test.ts` | 7 | Concurrent SSE requests, stream cancellation mid-flight, post-disconnect token safety, independent stream isolation |
| `tests/unit/api/chat-attachments.test.ts` | 16 | OOM-prevention size guards: MAX_INLINE_TEXT (512 KB), MAX_INLINE_IMAGE (5 MB), TEXT_MIME_TYPES coverage, preview size validation |
| `tests/unit/channels/inbound-email.test.ts` | 5 | System sender classification priority over security keywords, severity assignment, summary content |
| `tests/unit/components/chat-panel-split.test.ts` | 24 | ChatPanel split verification — subcomponent structure, memo isolation, shared types, props interface, state ownership, file size reduction |
| `tests/unit/components/message-virtualization.test.ts` | 10 | Message list virtualization — useVirtualizer, windowed rendering, overscan, absolute positioning, auto-scroll via scrollToIndex, dynamic measurement |
| `tests/unit/mcp/mcp-manager.test.ts` | 18 | listChanged auto-refresh, qualifyToolName 64-char enforcement, callTool truncated-name reverse mapping |
| `tests/unit/agent/expand-multi-tool-use.test.ts` | 10 | multi_tool_use.parallel expansion, mixed calls, missing parameters, empty recipient_name, bare multi_tool_use |
