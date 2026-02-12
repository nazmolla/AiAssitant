# Nexus Agent: Sovereign Proactive Personal AI

Nexus is a standalone, background-running **Personal Sovereign Agent** designed for a single user. It integrates deep memory, proactive environmental awareness via the Model Context Protocol (MCP), and a Human-in-the-Loop (HITL) safety architecture.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment variables
cp .env.example .env
# Edit .env with your API keys and auth provider credentials

# 3. Initialize the SQLite database
npm run db:init

# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the Command Center.

---

## 1. High-Level Architecture

The system follows a **Sense-Think-Act** loop. It doesn't just respond to prompts; it observes its environment through connected services and acts autonomously based on a persistent knowledge base of user preferences.

### Core Architectural Principles

- **Single User Sovereignty** — All data, history, and "knowledge" are stored in a local SQLite database.
- **Proactive Intelligence** — A background scheduler periodically triggers the agent to analyze external services (Email, GitHub, Azure) via MCPs.
- **Human-in-the-Loop (HITL)** — Sensitive actions are intercepted and held in an approval queue until the owner grants permission.
- **Native SDKs** — Direct use of official Azure AI, Anthropic, and MCP SDKs for maximum control (No LangChain).
- **Identity-Locked** — Authenticated via Azure AD or Google OIDC, pinned to a single owner subject ID.

---

## 2. Technical Stack Requirements

| Layer | Component | Requirement |
|-------|-----------|-------------|
| Runtime | Node.js | v20.x or higher (LTS) |
| Language | TypeScript | v5.x with Strict Mode enabled |
| Database | SQLite | `better-sqlite3` for synchronous, low-latency state |
| Frontend | Next.js | v14+ (App Router), TailwindCSS, ShadcnUI |
| LLM SDKs | Native | `@azure/openai`, `@anthropic-ai/sdk`, `openai` |
| Protocol | MCP | `@modelcontextprotocol/sdk` |
| Auth | OIDC | Auth.js (NextAuth) with Azure AD or Google Provider |

---

## 3. Database Schema (SQLite)

### A. Identity & Configuration

```sql
CREATE TABLE identity_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    owner_email TEXT NOT NULL,
    provider_id TEXT NOT NULL,      -- 'azure-ad' | 'google'
    external_sub_id TEXT UNIQUE,    -- OIDC Subject ID
    api_keys_encrypted TEXT         -- JSON blob of encrypted keys
);

CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport_type TEXT,            -- 'stdio' | 'sse'
    command TEXT NOT NULL,          -- e.g., 'npx'
    args TEXT,                      -- JSON array string
    env_vars TEXT                   -- JSON object string
);
```

### B. Memory & Knowledge

```sql
CREATE TABLE user_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT NOT NULL,           -- e.g., 'Project X'
    attribute TEXT NOT NULL,        -- e.g., 'Preferred Tech'
    value TEXT NOT NULL,            -- e.g., 'Azure AI'
    source_context TEXT,            -- Snippet of conversation where fact was learned
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE threads (
    id TEXT PRIMARY KEY,            -- UUID
    title TEXT,
    status TEXT DEFAULT 'active',   -- 'active' | 'awaiting_approval' | 'archived'
    last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT REFERENCES threads(id),
    role TEXT CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT,
    tool_calls TEXT,                -- JSON blob of tool requests
    tool_results TEXT               -- JSON blob of tool outputs
);
```

### C. Safety & Proactive Actions

```sql
CREATE TABLE tool_policies (
    tool_name TEXT PRIMARY KEY,     -- e.g., 'github.create_issue'
    mcp_id TEXT REFERENCES mcp_servers(id),
    requires_approval BOOLEAN DEFAULT 1,
    is_proactive_enabled BOOLEAN DEFAULT 0
);

CREATE TABLE approval_queue (
    id TEXT PRIMARY KEY,
    thread_id TEXT REFERENCES threads(id),
    tool_name TEXT,
    args TEXT,                      -- JSON arguments
    reasoning TEXT,                 -- LLM's explanation for the action
    status TEXT DEFAULT 'pending'   -- 'pending' | 'approved' | 'rejected'
);
```

---

## 4. Component Requirements & Logic

### 4.1 The Intelligence Adapter (LLM Layer)

- **Logic:** Must implement a `ChatProvider` interface. It dynamically switches between Azure OpenAI and Anthropic SDKs based on the `identity_config`.
- **Tool Mapping:** Logic to convert MCP JSON-RPC tool definitions into OpenAI-compatible or Anthropic-compatible tool schemas.

### 4.2 The Proactive Scheduler (The Observer)

- **Logic:** Runs as a background cron job (e.g., every 15 minutes).
- Polls data from proactive-enabled MCPs (e.g., `gmail.list_messages`).
- Fetches relevant `user_knowledge` for context.
- Calls the LLM to assess if any retrieved information requires a reminder or action.
- If action is triggered, it checks `tool_policies`. If restricted, it inserts a record into `approval_queue` and notifies the user via WhatsApp/Web Portal.

### 4.3 The Human-in-the-Loop (HITL) Gatekeeper

- **Logic:** A wrapper around the MCP `callTool` function.
- **Intercepts calls:**
  ```
  if (policy.requires_approval) { pause_thread(); create_approval_request(); }
  ```
- Thread state is frozen in SQLite until the `approval_queue.status` changes to `'approved'` via a WebSocket/API call from the Next.js UI.

---

## 5. User Interface (The Command Center)

- **Dashboard** — Real-time stream of agent "thoughts" and logs.
- **Approval Inbox** — List of pending actions with "Approve", "Edit", and "Deny" buttons.
- **Knowledge Vault** — CRUD interface for the `user_knowledge` table, allowing manual correction of learned facts.
- **MCP Config** — Interface to add/remove MCP servers and toggle "Manual Approval" for every specific tool discovered.

---

## 6. Development & AI Prompting Roadmap

| Phase | Focus | Description |
|-------|-------|-------------|
| **Phase 1** | Database | Initialize a Node.js TypeScript project with `better-sqlite3`. Implement the schema defined in `nexus_agent_spec.md`. |
| **Phase 2** | Auth | Implement Auth.js (NextAuth) with an Azure AD or Google provider. Create a middleware that ensures only the owner (first registered user) can access the API. |
| **Phase 3** | MCP Client | Build an MCP Manager using `@modelcontextprotocol/sdk` that can connect to stdio and SSE transports and list available tools. |
| **Phase 4** | Agent Logic | Create an agent loop using native Azure OpenAI SDK. Implement the tool-policy gatekeeper that checks the SQLite database before executing any MCP tool. |
| **Phase 5** | Proactive | Implement a cron-based proactive service that polls MCP tools and uses the LLM to generate reminders or draft actions. |
