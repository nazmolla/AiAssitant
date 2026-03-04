# Nexus Agent — Getting Started

> Back to [Usage Overview](USAGE.md) | [Daily Workflows](USAGE_DAILY_WORKFLOWS.md) | [Configuration](USAGE_CONFIGURATION.md)

---

## 1) Sign In

1. Open `/auth/signin`
2. Sign in with local credentials or configured OAuth provider
3. On first login in a fresh system, the first account becomes admin

## 2) Understand the Main Layout

Nexus runs as a single-page command center with tab navigation in the left drawer.

![Command Center overview (test env)](images/usage-command-center-overview.png)

| Tab | Primary Use |
|-----|-------------|
| **Chat** | Ask, plan, execute with assistant |
| **Dashboard** | Observe activity and events |
| **Approvals** | Review pending HITL actions |
| **Knowledge** | Manage remembered facts |
| **Settings** | Configure providers, tools, channels, and account/admin features |

Top-right account name opens an **Account menu** with quick access to **Profile** and **Sign out**.

## 3) Complete Your First Successful Flow

1. Go to **Chat**
2. Create a thread
3. Send a prompt
4. Verify streaming response appears
5. If a tool call is gated, approve it inline or via Approvals

![Chat tab (test env)](images/usage-chat.png)

---

## What to Read Next

- For regular usage patterns: [USAGE_DAILY_WORKFLOWS.md](USAGE_DAILY_WORKFLOWS.md)
- For setup and integrations: [USAGE_CONFIGURATION.md](USAGE_CONFIGURATION.md)
- For admin controls: [USAGE_ADMIN.md](USAGE_ADMIN.md)
