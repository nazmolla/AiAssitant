# Nexus Agent — Getting Started

> Back to [Usage Overview](USAGE.md) | [Daily Workflows](USAGE_DAILY_WORKFLOWS.md) | [Configuration](USAGE_CONFIGURATION.md)

---

> **Summary:** Sign in, learn the layout, and complete your first successful interaction — all in under 5 minutes.

---

## 1) Sign In

1. Open `/auth/signin`
2. Sign in with local credentials or a configured OAuth provider
3. The first account created on a fresh system becomes **admin**

## 2) Understand the Main Layout

Nexus runs as a single-page command center with tab navigation in the left drawer.

![Command Center overview](images/usage-command-center-overview.png)

| Tab | Purpose |
|-----|---------|
| **Chat** | Ask questions, plan, and execute tasks with the AI assistant |
| **Conversation** | Hands-free voice interaction |
| **Dashboard** | Analytics — activity trends, KPIs, and log drilldown |
| **Knowledge** | View and manage remembered facts |
| **Settings** | Configure providers, tools, channels, and admin features |

The **notification bell** (top-right) shows pending approvals and system alerts filtered by your **Notification Level** preference (Settings → Profile). "Mark all as read" clears all notifications from the bell — they remain in Dashboard → Logs.
Your **account name** (top-right) opens quick access to **Profile** and **Sign out**. The display name is fetched live from your profile on each page load.

## 3) First Successful Flow

1. Go to **Chat**
2. Type a message on the **welcome screen** and press Enter (or click Send) — a thread is created automatically, or create one manually via the sidebar
3. Verify the streaming response appears
4. If a tool call requires approval, approve it inline or via the notification bell

![Chat tab](images/usage-chat.png)

---

## What to Read Next

- [Daily Workflows](USAGE_DAILY_WORKFLOWS.md) — chat, approvals, knowledge, voice, scheduling
- [Configuration](USAGE_CONFIGURATION.md) — LLM providers, MCP, channels, Alexa
- [Admin Operations](USAGE_ADMIN.md) — user management, auth providers, governance
