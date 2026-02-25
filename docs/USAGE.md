# Nexus Agent — Usage & Configuration

> Back to [README](../README.md) | [Architecture](ARCHITECTURE.md) | [Tech Specs](TECH_SPECS.md) | [Installation](INSTALLATION.md)

---

## User Interface (Command Center)

The Command Center is a single-page dashboard with a premium dark theme (coral accent, glass morphism effects). All tabs are accessible from the left sidebar.

| Tab | Description |
|-----|-------------|
| **Dashboard** | Real-time agent activity logs with level-based filtering (info, warning, error) |
| **Chat** | Threaded conversations with file attachments, inline screenshots, streaming responses, inline approval buttons, and live screen sharing |
| **Approvals** | Pending tool execution requests with approve/reject controls (user-scoped) |
| **Knowledge** | Searchable CRUD interface for the user's knowledge vault |
| **MCP Servers** | Add/remove/connect MCP servers with transport auto-detection and scope control |
| **Channels** | Configure communication channels (WhatsApp, Discord, webhooks) |
| **LLM Config** | Add/switch between chat and embedding providers at runtime |
| **Profile** | Per-user profile editor (name, bio, skills, social links) with feature toggles |
| **User Management** | *(Admin only)* Enable/disable users, change roles, manage per-user permissions |

---

## Chat

### Starting a Conversation

1. Open the **Chat** tab
2. Click **New Thread** to create a conversation
3. Type a message and press Enter or click Send

The agent responds with streaming text. If the agent needs to use a tool, the tool call is shown only when approval is required — otherwise tool interactions are hidden for a clean UX.

### File Attachments

Drag-and-drop or click the attachment button to upload files. Uploaded files are stored on the server and available to the agent for the duration of the thread.

### Screen Sharing

Click the screen share button to share your screen with the agent using the browser's `getDisplayMedia()` API. Captured frames are sent to the LLM as vision input — the agent can see what you see and reason about it.

> Screen sharing can be enabled/disabled per user in the **Profile** tab.

### Inline Approvals

When a tool call requires approval, an approve/deny button pair appears directly in the chat. No need to switch to the Approvals tab.

---

## LLM Configuration

### Adding a Provider

1. Open the **LLM Config** tab
2. Click **Add Provider**
3. Select a provider type:
   - **Azure OpenAI** — requires API key + endpoint URL + deployment name
   - **OpenAI** — requires API key + model name (e.g., `gpt-4o`)
   - **Anthropic** — requires API key + model name (e.g., `claude-sonnet-4-20250514`)
4. Set the purpose: **chat** (for conversations) or **embeddings** (for knowledge search)
5. Mark one chat provider and one embedding provider as **default**

### Switching Providers

Toggle the default provider at any time from the LLM Config panel. Changes take effect immediately — no restart required.

### Embedding Models

If an embedding provider is configured, knowledge entries are stored with vector embeddings for semantic search. Without one, the system falls back to SQLite keyword (`LIKE`) search.

---

## MCP Servers

### Adding an MCP Server

1. Open the **MCP Servers** tab
2. Click **Add Server**
3. Choose a transport type:

| Transport | Fields | Example |
|-----------|--------|---------|
| **Stdio** | Command, arguments, env vars | `npx @modelcontextprotocol/server-github` |
| **SSE** | Server URL | `http://homeassistant:8123/mcp/sse` |
| **Streamable HTTP** | Server URL | `http://homeassistant:8123/mcp` |

4. Set the **scope**:
   - **Global** — available to all users (admin only)
   - **User** — available only to you
5. Configure authentication if needed: None, Bearer Token, or OAuth

### Connecting

After adding, click **Connect** to establish the connection. Available tools are automatically discovered and shown in the tools list.

### Tool Policies

Each discovered tool gets a policy entry controlling:
- **Requires Approval** — whether the tool call needs HITL approval before execution
- **Proactive Enabled** — whether the scheduler can invoke this tool autonomously

Configure policies from the **Approvals** tab or via the API.

---

## Communication Channels

### Supported Channel Types

| Type | Configuration | How It Works |
|------|--------------|--------------|
| **WhatsApp** | Webhook URL + secret | Receives messages via WhatsApp Business API webhook |
| **Discord** | Bot token + application ID (env vars) | Gateway bot responds to mentions, DMs, and `/ask` slash commands |
| **Custom Webhook** | Auto-generated webhook URL + optional secret | Any service can POST messages to the channel endpoint |

### Setting Up a Channel

1. Open the **Channels** tab
2. Click **Add Channel**
3. Select the channel type and fill in the configuration
4. Copy the generated webhook URL and configure it in the external service

Channels are **user-scoped** — messages arriving on your channel are routed to your threads and knowledge vault.

### Discord Bot Setup

1. Set `DISCORD_BOT_TOKEN` and `DISCORD_APPLICATION_ID` in your `.env` file
2. Invite the bot to your Discord server with message read/send permissions
3. The bot responds to:
   - **Mentions** (`@NexusAgent what's the weather?`)
   - **DMs** (direct messages to the bot)
   - **Slash commands** (`/ask <question>`)

---

## Knowledge Vault

### Automatic Knowledge Capture

After every agent response, the LLM extracts durable facts from the conversation and stores them in your personal knowledge vault. No manual input needed.

Captured knowledge follows an **entity-attribute-value** model:
- **Entity** — the subject (e.g., "Mohamed", "Project X")
- **Attribute** — what's being stored (e.g., "email", "deadline")
- **Value** — the actual data

### Manual Management

From the **Knowledge** tab you can:
- **Search** — find entries by keyword or semantic similarity
- **Add** — manually create knowledge entries
- **Edit** — update existing entries
- **Delete** — remove outdated information

### Semantic Search

If an embedding model is configured, knowledge retrieval uses cosine similarity to find the most relevant entries. The top-K results are included in the agent's context before responding.

---

## Human-in-the-Loop (HITL)

### How It Works

1. The agent decides to call a tool
2. The gatekeeper checks the tool's policy
3. If `requires_approval` is true → execution is **paused** and an approval request is created
4. You review the request in the **Approvals** tab or via inline chat buttons
5. On **approve** — the tool executes and the agent loop resumes automatically
6. On **reject** — the agent is informed and adjusts its approach

### Default Policies

- **File write/delete operations** — approval required by default
- **MCP server tools** — approval required by default (configurable per tool)
- **Web search/fetch** — no approval required
- **Browser automation** — no approval required

### Approval Inbox

The Approvals tab shows all pending requests for your threads. Each entry displays:
- The tool name and arguments
- The agent's reasoning for wanting to call the tool
- Approve / Reject buttons

---

## Proactive Scheduler

### What It Does

A background cron job that monitors proactive-enabled MCP tools on a configurable interval:

1. Polls proactive-enabled tools for new data
2. Retrieves relevant user knowledge for context
3. Calls the LLM to assess whether any data needs attention
4. Creates approval requests or notifications as needed

### Enabling Proactive Tools

1. Connect an MCP server with tools you want to monitor
2. Go to the tool's policy settings
3. Toggle **Proactive Enabled** to on
4. The scheduler will start polling that tool on its configured interval

---

## User Management (Admin)

### Managing Users

From the **User Management** tab, admins can:

| Action | Description |
|--------|-------------|
| **View all users** | See email, role, status, and sign-up date |
| **Change role** | Promote user to admin or demote to user |
| **Enable/Disable** | Disabled users cannot sign in |
| **Manage permissions** | Toggle per-user access to: Knowledge, Chat, MCP, Channels, Approvals, Settings |
| **Delete user** | Permanently remove a user and their data |

### Permission Granularity

| Permission | Controls Access To |
|-----------|-------------------|
| `can_knowledge` | Knowledge vault (view, search, add, edit, delete) |
| `can_chat` | Chat threads and conversations |
| `can_mcp` | MCP server management |
| `can_channels` | Communication channel configuration |
| `can_approvals` | HITL approval inbox |
| `can_settings` | LLM config and profile settings |

---

## Profile Settings

Each user can customize their profile from the **Profile** tab:

- **Display name, title, bio** — shown in the UI
- **Contact info** — phone, email, website
- **Social links** — LinkedIn, GitHub, Twitter
- **Skills & languages** — stored as JSON arrays
- **Feature toggles** — enable/disable features like screen sharing
