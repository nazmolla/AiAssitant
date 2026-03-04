# Nexus Agent — Technical Specifications

> Back to [README](../README.md) | [Architecture](ARCHITECTURE.md) | [Installation](INSTALLATION.md) | [Usage](USAGE.md)

---

## Technical Stack

| Layer | Component | Details |
|-------|-----------|---------|
| Runtime | Node.js | v20+ (LTS). Tested on x86-64 and ARM64. |
| Language | TypeScript | v5.x, Strict Mode |
| Database | SQLite | `better-sqlite3` — zero-config, single-file persistence. **Application cache** (`src/lib/cache.ts`) — in-memory write-through cache with 60s TTL and explicit invalidation for LLM providers, tool policies, user records, and profiles to avoid redundant synchronous DB queries on every request. |
| Frontend | Next.js 14 | App Router, Material UI (MUI v7) with 7 color themes, TailwindCSS, screen sharing via getDisplayMedia, **Markdown rendering** via `react-markdown` + `remark-gfm` |
| HTTPS | nginx + self-signed cert | Reverse proxy HTTPS:443 → Next.js:3000. Required for mic access over network. TLSv1.2/1.3, HTTP → HTTPS redirect, SSE passthrough. |
| Audio | OpenAI Whisper + TTS-1 | Speech-to-Text (mic input, 25 MB max, webm/wav/mp3/ogg/flac) and Text-to-Speech (9 voices, MP3 output). Supports dedicated `tts` and `stt` purpose providers with standard deployment field for Azure OpenAI. **Local Whisper fallback** — optional local Whisper server (faster-whisper-server or whisper.cpp) as automatic backup when cloud STT fails. **Audio mode** — hands-free conversation with auto-listen and streaming TTS. **Conversation Mode** — dedicated `/conversation` tab with VAD-based automatic speech endpoint detection (WebAudio AnalyserNode, 1.2 s silence / 0.4 s min speech), lightweight `/api/conversation/respond` endpoint (full tool support, no knowledge/profile/DB overhead), in-memory client-side history (30 msg cap), real-time audio level visualization, atomic `stateRef` sync via `useCallback`, auto-listen after response, and **interrupt / barge-in** (separate interrupt VAD with 200 ms sustained speech at 2× threshold triggers abort of LLM + TTS, marks transcript with ⸺, transitions to listening). |
| LLM SDKs | Native | `@azure/openai`, `openai`, `@anthropic-ai/sdk`, LiteLLM proxy. **Streaming responses** — tokens are streamed in real-time via SSE `token` events for instant perceived latency. SSE writes use a `sseSend()` safety wrapper with `streamCancelled` flag to prevent crashes when clients disconnect mid-stream. **Worker Thread isolation** — LLM API calls run in a dedicated Node.js Worker Thread (`scripts/agent-worker.js`) to prevent token streaming from blocking the main event loop. Tool execution, DB access, and knowledge retrieval remain on the main thread with IPC-based coordination. Automatic fallback to main thread if worker is unavailable. |
| MCP | v1.26+ | Stdio, SSE, and Streamable HTTP transports. `list_changed` auto-refresh (500 ms debounce). |
| Discord | discord.js | Gateway bot with mentions, DMs, and slash commands |
| Auth | NextAuth v4 | Credentials (email + password) and OAuth (Azure AD, Google) |
| iOS App | SwiftUI | Native iOS 17+ companion app with full feature parity (see [iOS README](../ios/NexusAgent/README.md)) |
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
    is_proactive_enabled BOOLEAN DEFAULT 0,
    scope TEXT DEFAULT 'global'         -- 'global' (all users) | 'user' (admin only)
);

CREATE TABLE approval_queue (
    id TEXT PRIMARY KEY,
    thread_id TEXT REFERENCES threads(id),  -- NULL for proactive (scheduler) approvals
    tool_name TEXT, args TEXT, reasoning TEXT,
    status TEXT DEFAULT 'pending',       -- 'pending' | 'approved' | 'rejected'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

> **Proactive approvals**: When `thread_id` is `NULL`, the approval was created by the proactive scheduler (no associated chat thread). These appear in the Approval Inbox for admins and are executed directly when approved — no agent loop continuation is needed.
>
> **Severity capping**: Smart home / IoT tool assessments (prefixes: `builtin.alexa_`, `builtin.smart_home_`, `builtin.iot_`, `builtin.hue_`, `builtin.nest_`, `builtin.ring_`) are automatically capped at `high` severity — they can never produce `disaster`-level events.

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

---

## API Routes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET/POST` | `/api/threads` | User | List/create threads (user-scoped) |
| `GET/DELETE` | `/api/threads/[threadId]` | User | Get/delete thread (ownership enforced) |
| `POST` | `/api/threads/[threadId]/chat` | User | Send message and run agent loop (SSE streaming: `token`, `status`, `message`, `done`, `error` events) |
| `GET/POST` | `/api/knowledge` | User | List/upsert knowledge entries (user-scoped) |
| `GET/POST` | `/api/mcp` | User | List/add MCP servers (global + user-scoped) |
| `POST` | `/api/mcp/[serverId]/connect` | Auth | Connect to an MCP server |
| `GET` | `/api/mcp/tools` | Auth | List all available MCP tools |
| `GET/POST` | `/api/approvals` | Auth | List/resolve pending approvals (includes proactive/threadless approvals for admins) |
| `GET/POST` | `/api/policies` | Auth | List/update tool policies |
| `GET` | `/api/logs` | Auth | Fetch agent activity logs |
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
| `GET` | `/api/admin/users` | Admin | List all users with permissions |
| `PUT/DELETE` | `/api/admin/users` | Admin | Update user role/status or delete user |
| `GET` | `/api/admin/users/me` | User | Get current user's role and permissions |
| `POST` | `/api/conversation/respond` | User | Lightweight LLM endpoint for voice conversation with full tool support (SSE streaming: `token`, `tool_call`, `tool_result`, `done`, `error` events). Skips knowledge retrieval, profile context, and DB persistence for fast response. |

---

## Tool Dispatch & Name Normalization

All built-in tools use the `builtin.` prefix (e.g. `builtin.alexa_announce`, `builtin.browser_navigate`). MCP tools use `serverId.toolName` format.

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
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=(), interest-cohort=()` |
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

**834 tests across 69 suites** — all passing.

| Category | Suites | Description |
|----------|--------|-------------|
| Unit | ~50 | Agent loop, gatekeeper, discovery, orchestrator, DB queries, API routes, auth guards |
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
| `tests/component/full-navigation.test.tsx` | 63 | All 5 main tabs, all 11 settings pages (via chips and URL routing), loading-state guards, permission gating, admin-only visibility, UI elements, redirects |
| `tests/component/component-render.test.tsx` | 20 | Render + content verification for all settings components (LlmConfig, ChannelsConfig, AuthConfig, UserManagement, CustomToolsConfig, LoggingConfig, WhisperConfig, ApprovalInbox, KnowledgeVault, ApiKeysConfig) |
| `tests/component/page.test.tsx` | 17 | Core page rendering, tab switching, drawer navigation |
| `tests/component/settings-panel.test.tsx` | 4 | Settings chip selection, visibility |
| `tests/component/conversation-tts-transition.test.tsx` | 6 | TTS → listening/idle transition, auto-listen toggle, no stuck speaking state, TTS error recovery, timing |
| `tests/component/conversation-interrupt.test.tsx` | 8 | Interrupt during speaking/thinking, ⸺ transcript marker, brief-noise rejection, no interrupt in idle/listening, stopEverything cleanup, full cycle after interrupt |
| `tests/integration/api/sse-concurrency.test.ts` | 7 | Concurrent SSE requests, stream cancellation mid-flight, post-disconnect token safety, independent stream isolation |
