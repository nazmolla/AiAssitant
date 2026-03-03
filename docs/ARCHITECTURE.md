# Nexus Agent — Architecture

> Back to [README](../README.md) | [Tech Specs](TECH_SPECS.md) | [Installation](INSTALLATION.md) | [Usage](USAGE.md)

---

## Architecture Diagram

```mermaid
%%{init: {'theme':'base','themeVariables': {'fontSize': '17px','fontFamily':'Inter, Segoe UI, sans-serif'}}}%%
flowchart LR
    subgraph C["🟦 Channels"]
        WEB["Web Chat"]
        DISCORD["Discord"]
        WHATSAPP["WhatsApp"]
        WEBHOOK["Webhooks"]
        EMAIL["Email (IMAP/SMTP)"]
    end

    subgraph S["🟨 Security + Auth"]
        NGINX["nginx\nHTTPS reverse proxy"]
        MW["Middleware\nRate limit + security headers"]
        AUTH["NextAuth\nJWT session"]
        TRUST["Untrusted Email Guard\nPrompt-injection boundary"]
    end

    subgraph A["🟥 Agent Core (Sense → Think → Act)"]
        LOOP["Agent Loop"]
        ORCH["Model Orchestrator\nTask classifier + scorer"]
        GATE["HITL Gatekeeper\nTool policy enforcement"]
        KNOW["Knowledge System\nCapture + retrieval"]
        SCHED["Proactive Scheduler"]
        INBOUND["Inbound Email Classifier\nSummary + severity"]
        NOTIFY["Channel Notifier\nPer-user thresholds"]
        AUDIO["Audio Engine\nSTT (Whisper) + TTS"]
    end

    subgraph T["🟧 Execution Surfaces"]
        subgraph BT["Built-in Tools"]
            WEBT["Web Tools"]
            BROWSER["Browser Tools"]
            FS["File System Tools"]
            CUSTOM["Custom Tools (Sandbox)"]
            ALEXA["Alexa Smart Home (14)"]
        end
        subgraph MCP["MCP Servers"]
            STDIO["Stdio"]
            SSE["SSE"]
            HTTP["Streamable HTTP"]
        end
    end

    subgraph L["🟪 LLM Providers"]
        AZURE["Azure OpenAI"]
        OPENAI["OpenAI"]
        ANTHRO["Anthropic"]
    end

    subgraph D["🟩 Data"]
        DB[("SQLite\nnexus.db")]
        EMBED["Vector Embeddings"]
    end

    subgraph LEG["Legend"]
        LEG1["🟦 Inbound/Outbound Channels"]
        LEG2["🟨 Security Boundary"]
        LEG3["🟥 Core Decision Engine"]
        LEG4["🟧 Tool / MCP Execution"]
        LEG5["🟪 Model Providers"]
        LEG6["🟩 Persistence + Retrieval"]
    end

    WEB --> NGINX --> MW --> AUTH --> LOOP
    WHATSAPP --> MW
    WEBHOOK --> MW
    DISCORD --> LOOP
    EMAIL --> INBOUND --> TRUST --> LOOP
    INBOUND --> NOTIFY

    SCHED --> LOOP
    SCHED --> NOTIFY

    LOOP --> ORCH --> AZURE
    ORCH --> OPENAI
    ORCH --> ANTHRO

    LOOP --> KNOW --> EMBED
    KNOW --> DB
    LOOP --> DB

    WEB -->|mic| AUDIO
    AUDIO -->|Whisper| OPENAI
    AUDIO -->|TTS-1| OPENAI
    AUDIO --> WEB

    LOOP --> GATE
    GATE -->|approved| WEBT
    GATE -->|approved| BROWSER
    GATE -->|approved| FS
    GATE -->|approved| CUSTOM
    GATE -->|approved| ALEXA
    GATE -->|approved| STDIO
    GATE -->|approved| SSE
    GATE -->|approved| HTTP
    GATE --> DB

    LOOP --> NOTIFY --> DISCORD
    NOTIFY --> WHATSAPP
    NOTIFY --> WEBHOOK
    NOTIFY --> EMAIL

    classDef channels fill:#12395b,stroke:#4ea8de,color:#ffffff,stroke-width:2px;
    classDef security fill:#4a3b00,stroke:#f4d35e,color:#ffffff,stroke-width:2px;
    classDef core fill:#5f0f40,stroke:#ff6b6b,color:#ffffff,stroke-width:2px;
    classDef tools fill:#6b2f00,stroke:#f49d37,color:#ffffff,stroke-width:2px;
    classDef llm fill:#3c1f6e,stroke:#b8a1ff,color:#ffffff,stroke-width:2px;
    classDef data fill:#0b4f3c,stroke:#57cc99,color:#ffffff,stroke-width:2px;
    classDef legend fill:#1f2937,stroke:#9ca3af,color:#ffffff,stroke-width:1px;

    class WEB,DISCORD,WHATSAPP,WEBHOOK,EMAIL channels;
    class NGINX,MW,AUTH,TRUST security;
    class LOOP,ORCH,GATE,KNOW,SCHED,INBOUND,NOTIFY,AUDIO core;
    class WEBT,BROWSER,FS,CUSTOM,ALEXA,STDIO,SSE,HTTP tools;
    class AZURE,OPENAI,ANTHRO llm;
    class DB,EMBED data;
    class LEG1,LEG2,LEG3,LEG4,LEG5,LEG6 legend;
```

---

## Sense-Think-Act Loop

The system follows a **Sense-Think-Act** loop. It observes its environment through MCP servers, built-in web/browser/file-system tools, and communication channels — then acts autonomously grounded in per-user knowledge.

1. **Sense** — Receive input from web chat, Discord, WhatsApp, webhooks, or the proactive scheduler
2. **Think** — Retrieve relevant knowledge via semantic search, construct a context-rich prompt, and call the LLM
3. **Act** — Execute tool calls (with HITL gating), capture new knowledge, and deliver the response

### Voice Input & Output (STT / TTS)

The chat interface supports **voice input** (Speech-to-Text) and **voice output** (Text-to-Speech) powered by OpenAI's audio models.

- **Speech-to-Text**: Click the mic button to record audio via the browser MediaRecorder API (`audio/webm;codecs=opus`). The recording is sent to `POST /api/audio/transcribe` which forwards it to OpenAI's **Whisper** (`whisper-1`) model. The transcribed text is appended to the chat input field. Max file size: 25 MB.
- **Text-to-Speech**: Click the speaker icon on any assistant message to hear it read aloud. The message text is sent to `POST /api/audio/tts` which calls OpenAI's **TTS-1** model (default voice: `nova`, 9 voices available). The MP3 audio plays inline via the browser Audio API. Click again to stop playback.
- **Provider selection**: `getAudioClient()` in `src/lib/audio.ts` finds the first OpenAI-compatible provider (openai → azure-openai → litellm) — Anthropic is skipped as it has no audio API.

### Real-Time Streaming

The chat API uses **Server-Sent Events (SSE)** via a `TransformStream` to stream intermediate messages (thinking steps, tool calls, tool results) to the client in real-time as the agent loop progresses. The response is returned immediately with the readable side of the transform, while the agent loop writes SSE events to the writable side asynchronously. This gives immediate visibility into the agent's reasoning process instead of waiting for the full loop to complete. Each message includes a `created_at` timestamp persisted in the database.

The SSE stream supports three event types:

| Event      | Description |
|------------|-------------|
| `status`   | Agent analysis steps (model selection, knowledge retrieval, LLM call). Shown in a collapsible "Analyzing…" block in the UI — similar to Gemini/Copilot thinking indicators. |
| `message`  | Database-persisted messages (user, assistant, tool). Standard chat messages with full content. |
| `done`     | Final response metadata emitted when the agent loop completes. Triggers thread list refresh. |
| `error`    | Error details when the agent loop throws, sanitized to avoid leaking paths. |

The `status` events provide transparency into the agent's internal process for **every** response — not just tool-using ones — so users always see what the agent is doing (selecting a model, searching the knowledge vault, generating a response).

### Notification & Inbound Email Safety Path

- **Per-user thresholds** — Channel notifications are filtered by each user profile's `notification_level` (`low`, `medium`, `high`, `disaster`).
- **Channel-first alerts** — Proactive/admin/unknown-sender notices are delivered through configured communication channels instead of posting into chat threads.
- **Unknown sender summaries** — Inbound IMAP messages from unknown senders are summarized and severity-classified before notification routing.
- **Injection boundary** — Inbound email bodies are treated as untrusted external content and wrapped/sanitized before any LLM prompt ingestion.

---

## Core Architectural Principles

| Principle | Description |
|-----------|-------------|
| **Multi-User Isolation** | Each user's knowledge, threads, and profile are scoped by `user_id`. No cross-user data leakage. |
| **Proactive Intelligence** | A background scheduler polls MCP tools and uses the LLM to generate reminders or actions. |
| **Autonomous Knowledge Capture** | Every chat turn is mined for durable facts, keeping the Knowledge Vault up to date without manual entry. |
| **Vector-Aware Reasoning** | Semantic embedding search retrieves the most relevant knowledge before responding. |
| **Human-in-the-Loop (HITL)** | Unified tool policy system governs ALL tools (built-in, custom, and MCP). Per-tool approval and proactive toggles. Sensitive calls are held in an approval queue. |
| **Model Orchestrator** | Intelligent task routing classifies each message (complex/simple/background/vision) and selects the best LLM provider based on capabilities, speed, cost, and tier. |
| **Self-Extending Tools** | The agent can create, compile, and register new tools at runtime. Custom tools run in a VM sandbox with no file system or process access. |
| **Native SDKs** | Direct use of Azure OpenAI, OpenAI, Anthropic, LiteLLM, and MCP SDKs — no LangChain. |
| **MCP Auto-Refresh** | Subscribes to `list_changed` notifications from MCP servers. When a server installs or removes tools at runtime (e.g. Forage), the tool list is refreshed automatically with a 500 ms debounce — no restart required. |
| **Browser Automation** | Playwright-powered tools let the agent navigate pages, fill forms, take screenshots, and manage sessions. |
| **File System Access** | Built-in tools to read, write, list, and search files — with HITL gating on destructive operations. |
| **Multi-Channel Comms** | WhatsApp, Discord, webhooks, and web chat — each channel resolves senders to internal users. |
| **User-Scoped Alerting** | Per-user notification thresholds (`low` → `disaster`) suppress or deliver channel notifications based on event severity. |
| **Safe Email Ingestion** | Inbound email is classified, summarized, and guarded as untrusted content before reaching the agent loop. |
| **Screen Sharing** | Share your screen with the agent via browser `getDisplayMedia()` — the agent sees what you see and can reason about it. |
| **Voice I/O (STT/TTS)** | Mic button records audio via MediaRecorder, transcribes with Whisper. Speaker button on assistant messages plays TTS-1 audio. No extra dependencies — uses the existing OpenAI SDK. |
| **Security Hardened** | Comprehensive prompt injection defense, security headers (CSP, X-Frame-Options, etc.), rate limiting, input validation, and path traversal protection. |
| **Alexa Smart Home** | Native integration with Amazon Alexa — 14 tools for announcements, light control, volume, sensors, DND, and device management. Cookie-based auth with encrypted credential storage. |
| **Analytics-Driven Observability** | Dashboard computes date-range KPIs, session outcomes, trend charts, and topic drivers with interactive drilldown to raw logs. |

---

## Multi-User Model

### Roles & Access

| Role | Capabilities |
|------|-------------|
| **Admin** | Full access. Manage LLM providers, global MCP servers, tool policies, logs, **user management** (enable/disable users, change roles, manage permissions). First user to sign up. |
| **User** | Own knowledge vault, own threads, own channels, own profile. Access global MCP servers + user-scoped servers. Approve/reject tool calls on own threads. |

Admins can manage users from the **User Management** tab — enable/disable accounts, change roles, and control granular permissions (knowledge, chat, MCP, channels, approvals, settings).

### User Isolation

- **Knowledge** — The `user_knowledge` table is keyed by `user_id`. All queries (list, search, upsert, semantic search) are scoped to the requesting user. The unique index includes `user_id` so the same entity/attribute/value can exist for different users.
- **Threads** — Each thread stores a `user_id` foreign key. Thread listing and chat operations enforce ownership checks.
- **MCP Servers** — Each server has a `scope` field (`global` or `user`). Global servers are visible to all; user-scoped servers are visible only to their owner.
- **Profiles** — Per-user profile (display name, bio, skills, links) stored in `user_profiles`.

### User-Specific Channels

Communication channels are **owned by the user who creates them**. Each channel has a `user_id` foreign key:

- Channel listing is filtered by the authenticated user (admins see all)
- Only the channel owner can edit or delete their channels
- When a message arrives on a channel webhook, the system resolves the **channel owner** as the user and routes knowledge/threads accordingly
- Legacy `channel_user_mappings` table is preserved for backward compatibility but the primary resolution uses `getChannelOwnerId()`

---

## iOS Companion App

A native **SwiftUI** iOS app (`ios/NexusAgent/`) provides full feature parity with the web UI. The app communicates with the Nexus Agent server over the existing REST + SSE API — no backend changes required.

### iOS Architecture

| Layer | Pattern | Details |
|-------|---------|------------------------------------------|
| UI | SwiftUI | iOS 17+, TabView with 5 tabs |
| State | MVVM | 8 `@MainActor` ObservableObject ViewModels |
| Network | URLSession | Cookie-based auth, SSE streaming via `URLSessionDataDelegate` |
| Auth | NextAuth flow | CSRF → credentials callback → cookie session |
| Storage | Keychain | Server URL, session cookie, user info |
| Discovery | Network scan | Auto-discovers server on local network via `/api/auth/csrf` probe |

See the [iOS README](../ios/NexusAgent/README.md) for setup instructions.

---

## Project Structure

```
ios/NexusAgent/NexusAgent/    # iOS SwiftUI companion app
├── Models/                    # 15 Codable structs
├── Services/                  # APIClient, AuthService, SSEClient, KeychainService, ServerDiscovery
├── ViewModels/                # 8 MVVM ViewModels
├── Views/                     # Auth, Chat, Knowledge, Approvals, Settings, Profile
├── ContentView.swift          # TabView root
└── NexusAgentApp.swift        # @main entry point
src/
├── app/                        # Next.js App Router
│   ├── api/                    # API route handlers
│   │   ├── admin/              # User management (admin-only)
│   │   ├── approvals/          # HITL approval inbox (user-scoped)
│   │   ├── attachments/        # File upload/download
│   │   ├── audio/              # Voice I/O (STT transcribe + TTS synthesis)
│   │   ├── channels/           # Inbound webhook handlers
│   │   ├── config/             # LLM, channels, profile config
│   │   ├── knowledge/          # User knowledge CRUD
│   │   ├── logs/               # Agent activity logs
│   │   ├── mcp/                # MCP server management + OAuth
│   │   ├── policies/           # Tool policy management
│   │   ├── config/custom-tools/ # Custom tools management
│   │   └── threads/            # Thread + chat management
│   ├── auth/                   # Sign-in and error pages
│   ├── globals.css             # Theme and design tokens
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # Main dashboard SPA
├── components/                 # React UI components
│   ├── ui/                     # MUI adapter primitives (button, card, input, badge, switch, textarea, scroll-area)
│   ├── agent-dashboard.tsx     # Full analytics dashboard + drilldown log explorer
│   ├── approval-inbox.tsx      # HITL approval UI
│   ├── channels-config.tsx     # Channel management (user-scoped)
│   ├── chat-panel.tsx          # Thread/chat with inline approvals
│   ├── user-management.tsx     # Admin user management
│   ├── knowledge-vault.tsx     # Knowledge CRUD
│   ├── llm-config.tsx          # LLM provider management
│   ├── mcp-config.tsx          # MCP server management
│   └── profile-config.tsx      # User profile editor with feature toggles│   ├── alexa-config.tsx        # Alexa Smart Home credential management├── lib/
│   ├── agent/                  # Core agent logic
│   │   ├── loop.ts             # Sense-Think-Act agent loop
│   │   ├── gatekeeper.ts       # HITL policy enforcement
│   │   ├── custom-tools.ts     # Self-extending tool system (VM sandbox)
│   │   ├── web-tools.ts        # Web search/fetch tools
│   │   ├── browser-tools.ts    # Playwright browser automation
│   │   ├── fs-tools.ts         # File system tools
│   │   └── alexa-tools.ts      # Alexa Smart Home integration (14 tools)
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
│   │   ├── orchestrator.ts     # Model routing & task classification
│   │   ├── openai-provider.ts  # OpenAI / Azure OpenAI
│   │   ├── anthropic-provider.ts
│   │   ├── embeddings.ts       # Embedding generation
│   │   └── types.ts            # ChatProvider interface
│   ├── channels/               # Channel integrations
│   │   └── discord.ts          # Discord Gateway bot (uses channel owner resolution)
│   ├── mcp/                    # MCP client management
│   │   └── manager.ts          # Connect, discover, invoke, auto-refresh
│   ├── audio.ts                # Audio utility (getAudioClient, transcribeAudio, textToSpeech)
│   ├── scheduler/              # Proactive cron scheduler
│   └── bootstrap.ts            # Runtime initialization
└── middleware.ts                # Auth + rate limiting + security middleware
```
