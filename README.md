# Nexus Agent: Multi-User Proactive Personal AI

Nexus is a self-hosted, multi-user **Proactive AI Agent** with deep memory, browser automation, file-system tools, and extensibility through the Model Context Protocol (MCP). It features per-user knowledge isolation, a Human-in-the-Loop (HITL) safety architecture, and multi-channel communication (web chat, WhatsApp, and more).

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright for browser automation
npx playwright install chromium

# 3. Copy and configure environment variables
cp .env.example .env
# Edit .env with your API keys, NEXTAUTH_SECRET, and optional OAuth credentials

# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the Command Center.

> **First-time setup:** The first user to sign in (via email + password or OAuth) automatically becomes the **admin**. Subsequent users receive the **user** role. Each user gets isolated knowledge, threads, and profile settings.

---

## 1. High-Level Architecture

The system follows a **Sense-Think-Act** loop. It observes its environment through MCP servers, built-in web/browser/file-system tools, and communication channels — then acts autonomously grounded in per-user knowledge.

### Core Architectural Principles

| Principle | Description |
|-----------|-------------|
| **Multi-User Isolation** | Each user's knowledge, threads, and profile are scoped by `user_id`. No cross-user data leakage. |
| **Proactive Intelligence** | A background scheduler polls MCP tools and uses the LLM to generate reminders or actions. |
| **Autonomous Knowledge Capture** | Every chat turn is mined for durable facts, keeping the Knowledge Vault up to date without manual entry. |
| **Vector-Aware Reasoning** | Semantic embedding search retrieves the most relevant knowledge before responding. |
| **Human-in-the-Loop (HITL)** | Sensitive tool calls are held in an approval queue until explicitly approved. |
| **Native SDKs** | Direct use of Azure OpenAI, OpenAI, Anthropic, and MCP SDKs — no LangChain. |
| **Browser Automation** | Playwright-powered tools let the agent navigate pages, fill forms, take screenshots, and manage sessions. |
| **File System Access** | Built-in tools to read, write, list, and search files — with HITL gating on destructive operations. |
| **Multi-Channel Comms** | WhatsApp, webhooks, and web chat — each channel resolves senders to internal users. |

---

## 2. Technical Stack

| Layer | Component | Details |
|-------|-----------|---------|
| Runtime | Node.js | v20+ (LTS). Tested on x86 and ARM64 (Jetson Nano). |
| Language | TypeScript | v5.x, Strict Mode |
| Database | SQLite | `better-sqlite3` — zero-config, single-file persistence |
| Frontend | Next.js 14 | App Router, TailwindCSS, Radix UI primitives |
| LLM SDKs | Native | `@azure/openai`, `openai`, `@anthropic-ai/sdk` |
| MCP | v1.26+ | Stdio, SSE, and Streamable HTTP transports |
| Auth | NextAuth v4 | Credentials (email + password) and OAuth (Azure AD, Google) |
| Browser | Playwright | Chromium headless/headful for automation |
| Design | Custom | OpenClaw.ai-inspired dark theme with coral accent, glass effects |

---

## 3. Multi-User Model

### Roles & Access

| Role | Capabilities |
|------|-------------|
| **Admin** | Full access. Manage LLM providers, communication channels, global MCP servers, tool policies, logs. First user to sign up. |
| **User** | Own knowledge vault, own threads, own profile. Access global MCP servers + user-scoped servers. |

### User Isolation

- **Knowledge** — The `user_knowledge` table is keyed by `user_id`. All queries (list, search, upsert, semantic search) are scoped to the requesting user. The unique index includes `user_id` so the same entity/attribute/value can exist for different users.
- **Threads** — Each thread stores a `user_id` foreign key. Thread listing and chat operations enforce ownership checks.
- **MCP Servers** — Each server has a `scope` field (`global` or `user`). Global servers are visible to all; user-scoped servers are visible only to their owner.
- **Profiles** — Per-user profile (display name, bio, skills, links) stored in `user_profiles`.

### Channel User Mapping

Communication channels (WhatsApp, Slack, etc.) map external sender identities to internal users via `channel_user_mappings`:

```
channel_id + external_id (e.g., phone number)  →  user_id
```

When a message arrives on a channel webhook, the system resolves the sender to the correct user and routes knowledge/threads accordingly.

---

## 4. Database Schema (SQLite)

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    channel_type TEXT NOT NULL,          -- 'whatsapp' | 'slack' | 'webhook'
    label TEXT NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    config_json TEXT NOT NULL,
    webhook_secret TEXT
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

## 5. Agent Capabilities

### 5.1 Intelligence Adapter (LLM Layer)

Implements a `ChatProvider` interface with three built-in providers:

| Provider | SDK | Config Key |
|----------|-----|-----------|
| Azure OpenAI | `@azure/openai` | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Anthropic | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` |

Providers can be configured at runtime through the LLM Config panel (no restart needed). Tool schemas from MCP servers are automatically converted to each provider's native format.

### 5.2 Built-in Tools

#### Web Tools
| Tool | Description |
|------|-------------|
| `builtin.web_search` | Search the web via DuckDuckGo, returns titles/URLs/snippets |
| `builtin.web_fetch` | Fetch a URL and extract readable text content |
| `builtin.web_extract` | Fetch a URL and extract structured information with a query focus |

#### Browser Automation Tools (Playwright)
| Tool | Description |
|------|-------------|
| `builtin.browser_navigate` | Open a URL in a persistent Chromium session |
| `builtin.browser_click` | Click an element by selector or text |
| `builtin.browser_fill` | Fill form fields |
| `builtin.browser_screenshot` | Take a screenshot (returned inline as base64) |
| `builtin.browser_read_page` | Extract page content and interactive elements |
| + more | Upload, download, manage cookies, forward/back, scroll |

#### File System Tools (HITL-Gated)
| Tool | Description |
|------|-------------|
| `builtin.fs_read_file` | Read a file's contents |
| `builtin.fs_write_file` | Write content to a file (requires approval) |
| `builtin.fs_list_directory` | List directory contents |
| `builtin.fs_search_files` | Search for files by pattern |
| `builtin.fs_delete_file` | Delete a file (requires approval) |

### 5.3 MCP Servers

Connect external services via the Model Context Protocol. Supports three transport types:

| Transport | Use Case | Example |
|-----------|----------|---------|
| **Stdio** | Local CLI tools | `npx @modelcontextprotocol/server-github` |
| **SSE** | Remote servers (legacy) | `http://homeassistant:8123/mcp/sse` |
| **Streamable HTTP** | Remote servers (modern) | `http://homeassistant:8123/mcp` |

Authentication options: None, Bearer Token, or OAuth (with authorize/callback flow).

Each MCP server can be scoped as **global** (available to all users) or **user-specific** (available only to its creator).

### 5.4 Proactive Scheduler

A background cron job that:
1. Polls proactive-enabled MCP tools on a configurable interval
2. Retrieves relevant user knowledge for context
3. Calls the LLM to assess if any data needs attention
4. Creates approval requests or notifications as needed

### 5.5 Human-in-the-Loop (HITL) Gatekeeper

Wraps every tool call through a policy check:
- If `requires_approval` is true → thread is paused, approval request created
- Admin/user reviews in Approval Inbox → approve or reject
- On approval, the tool executes and the agent loop resumes automatically

### 5.6 Knowledge System

- **Auto-Capture** — After each agent turn, the LLM extracts durable facts and stores them in the user's knowledge vault
- **Semantic Retrieval** — Before responding, the agent retrieves the top-K most relevant knowledge entries via embedding similarity
- **Keyword Fallback** — If no embedding model is configured, falls back to SQLite `LIKE` search
- **User Isolation** — All knowledge operations are scoped by `user_id`

---

## 6. User Interface (Command Center)

Premium dark theme inspired by OpenClaw.ai, with coral accent colors, glass morphism effects, and Apple HIG design principles.

| Tab | Description |
|-----|-------------|
| **Dashboard** | Real-time agent activity logs with level-based filtering (info, warning, error) |
| **Chat** | Threaded conversations with file attachment support, inline screenshots, and streaming responses |
| **Approvals** | Pending tool execution requests with approve/reject controls |
| **Knowledge** | Searchable CRUD interface for the user's knowledge vault |
| **MCP Servers** | Add/remove/connect MCP servers with transport auto-detection, scope control, and OAuth flow |
| **Channels** | Configure communication channels (WhatsApp, webhooks) with sender-to-user mapping |
| **LLM Config** | Add/switch between chat and embedding providers at runtime |
| **Profile** | Per-user profile editor (name, bio, skills, social links) |

---

## 7. API Routes

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
| `GET/POST` | `/api/config/channels` | Auth | Manage communication channels |
| `GET/PUT` | `/api/config/profile` | User | Get/update user profile (user-scoped) |
| `POST` | `/api/channels/[channelId]/webhook` | Webhook | Receive inbound messages from channels |
| `POST` | `/api/attachments` | User | Upload file attachments |
| `GET` | `/api/attachments/[...path]` | Auth | Serve uploaded files |
| `GET/POST` | `/api/mcp/[serverId]/oauth/*` | Auth | OAuth authorize/callback for MCP servers |

---

## 8. Deployment

### Local Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

### Remote Deployment (e.g., Jetson Nano)

```bash
# Build locally
npm run build

# Package
tar -cf deploy.tar .next src package.json next.config.mjs postcss.config.mjs tailwind.config.ts tsconfig.json next-env.d.ts

# Transfer
scp deploy.tar user@host:/path/to/app/

# On the remote host
cd /path/to/app && tar -xf deploy.tar
npm install --production
NODE_OPTIONS='--max-old-space-size=256' npx next start -p 3000
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXTAUTH_SECRET` | Yes | Random secret for JWT signing |
| `NEXTAUTH_URL` | Yes | Base URL (e.g., `http://localhost:3000`) |
| `OPENAI_API_KEY` | One LLM required | OpenAI API key |
| `AZURE_OPENAI_API_KEY` | One LLM required | Azure OpenAI key |
| `AZURE_OPENAI_ENDPOINT` | With Azure key | Azure OpenAI endpoint URL |
| `ANTHROPIC_API_KEY` | One LLM required | Anthropic API key |
| `AZURE_AD_CLIENT_ID` | Optional | Azure AD OAuth app client ID |
| `AZURE_AD_CLIENT_SECRET` | Optional | Azure AD OAuth app client secret |
| `AZURE_AD_TENANT_ID` | Optional | Azure AD tenant ID |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth client secret |

---

## 9. Migration from Single-User

If upgrading from a previous single-owner installation, the database migration runs automatically on first startup:

1. Creates an admin user from the existing `identity_config` data
2. Back-fills `user_id` on all existing `user_knowledge` and `threads` rows
3. Migrates `owner_profile` data to the new `user_profiles` table
4. Legacy tables (`identity_config`, `owner_profile`) are preserved for compatibility

No manual steps required — the migration is idempotent and safe to run multiple times.

---

## 10. Project Structure

```
src/
├── app/                        # Next.js App Router
│   ├── api/                    # API route handlers
│   │   ├── approvals/          # HITL approval inbox
│   │   ├── attachments/        # File upload/download
│   │   ├── channels/           # Inbound webhook handlers
│   │   ├── config/             # LLM, channels, profile config
│   │   ├── knowledge/          # User knowledge CRUD
│   │   ├── logs/               # Agent activity logs
│   │   ├── mcp/                # MCP server management + OAuth
│   │   ├── policies/           # Tool policy management
│   │   └── threads/            # Thread + chat management
│   ├── auth/                   # Sign-in and error pages
│   ├── globals.css             # Theme and design tokens
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # Main dashboard SPA
├── components/                 # React UI components
│   ├── ui/                     # Primitives (button, card, input, etc.)
│   ├── agent-dashboard.tsx     # Activity log viewer
│   ├── approval-inbox.tsx      # HITL approval UI
│   ├── channels-config.tsx     # Channel management
│   ├── chat-panel.tsx          # Thread/chat interface
│   ├── knowledge-vault.tsx     # Knowledge CRUD
│   ├── llm-config.tsx          # LLM provider management
│   ├── mcp-config.tsx          # MCP server management
│   └── profile-config.tsx      # User profile editor
├── lib/
│   ├── agent/                  # Core agent logic
│   │   ├── loop.ts             # Sense-Think-Act agent loop
│   │   ├── gatekeeper.ts       # HITL policy enforcement
│   │   ├── web-tools.ts        # Web search/fetch tools
│   │   ├── browser-tools.ts    # Playwright browser automation
│   │   └── fs-tools.ts         # File system tools
│   ├── auth/                   # Authentication
│   │   ├── options.ts          # NextAuth config (multi-user)
│   │   ├── guard.ts            # requireUser/requireAdmin guards
│   │   └── index.ts            # Auth exports
│   ├── db/                     # Database layer
│   │   ├── schema.ts           # DDL definitions
│   │   ├── init.ts             # Schema init + migrations
│   │   ├── queries.ts          # All query functions
│   │   └── connection.ts       # SQLite connection
│   ├── knowledge/              # Knowledge system
│   │   ├── index.ts            # Ingestion pipeline
│   │   └── retriever.ts        # Semantic + keyword search
│   ├── llm/                    # LLM provider abstraction
│   │   ├── openai-provider.ts  # OpenAI / Azure OpenAI
│   │   ├── anthropic-provider.ts
│   │   ├── embeddings.ts       # Embedding generation
│   │   └── types.ts            # ChatProvider interface
│   ├── mcp/                    # MCP client management
│   │   └── manager.ts          # Connect, discover, invoke
│   ├── scheduler/              # Proactive cron scheduler
│   └── bootstrap.ts            # Runtime initialization
└── middleware.ts                # Auth middleware (JWT validation)
```
