# Nexus Agent — Usage Handbook

> Back to [README](../README.md) | [Architecture](ARCHITECTURE.md) | [Tech Specs](TECH_SPECS.md) | [Installation](INSTALLATION.md)

---

> **Summary:** This handbook covers how to use Nexus Agent — from first sign-in through daily workflows, configuration, and admin operations. Follow the reading path below or jump to the guide that matches your role.

All screenshots are captured from a **local test environment** with sample data.

---

## Reading Path

1. **Start here:** [Getting Started](USAGE_GETTING_STARTED.md) — sign-in, navigation, first flow
2. **Daily tasks:** [Daily Workflows](USAGE_DAILY_WORKFLOWS.md) — chat, approvals, knowledge, voice
3. **Configuration:** [Configuration](USAGE_CONFIGURATION.md) — LLM providers, MCP, channels, Whisper
4. **Admin ops:** [Admin Operations](USAGE_ADMIN.md) — users, auth providers, governance
5. **Issues:** [Troubleshooting](USAGE_TROUBLESHOOTING.md) — common problems and fixes

| Guide | Audience | Scope |
|------|----------|-------|
| [Getting Started](USAGE_GETTING_STARTED.md) | Everyone | Sign-in, navigation, first successful flow |
| [Daily Workflows](USAGE_DAILY_WORKFLOWS.md) | End users | Chat, approvals, knowledge, voice, scheduling |
| [Configuration](USAGE_CONFIGURATION.md) | Operators | LLM, MCP, tool policies, channels, Whisper |
| [Admin Operations](USAGE_ADMIN.md) | Admins | Users, auth providers, custom tools, scheduler, DB management |
| [Troubleshooting](USAGE_TROUBLESHOOTING.md) | Everyone | Common issues, diagnostics, recovery |

---

## UI Overview

![Command Center overview](images/usage-command-center-overview.png)

### Main Tabs

| Tab | Purpose |
|-----|---------|
| **Chat** | Conversational AI with streaming responses, tool execution, and file attachments |
| **Conversation** | Full-screen hands-free voice mode with auto-listen and interrupt support |
| **Dashboard** | Analytics — KPIs, session trends, error/activity charts with drilldown |
| **Knowledge** | View and manage the agent's learned facts about you |
| **Settings** | Providers, channels, tools, scheduler, profile, and admin controls |

### Key Concepts

- **Approvals** — Tools require human approval by default (default-deny). Approve inline in chat or via the notification bell. Save recurring decisions as **Standing Orders** (Settings → Standing Orders).
- **Knowledge Capture** — Every conversation is mined for durable facts, keeping the knowledge vault up to date automatically.
- **Proactive Scheduler** — Background automation that monitors tools, creates tasks, and surfaces actions for approval.
- **Job Scout** — Discovers matching roles, generates tailored resumes, and delivers them by email. Requires an Email channel and up-to-date profile.
- **Notification Bell** — The bell is filtered by your **Notification Level** preference (Settings → Profile). Only notifications at or above your threshold appear. "Mark all as read" clears the bell entirely — notifications remain accessible in Dashboard → Logs.
- **Welcome Screen** — Sending a message from the welcome screen (no thread selected) automatically creates a thread and sends the message in one step.

---

## Voice Conversation

The **Conversation** tab provides hands-free voice interaction:

1. Click the **microphone button** to start
2. Speak naturally — VAD auto-detects when you finish (1.2s silence)
3. Response is spoken back, then auto-listen resumes
4. **Interrupt** anytime by speaking while the agent is responding

Features: 9 TTS voices, auto/manual listen toggle, audio level visualizer, real-time transcript, and status indicators (Listening → Transcribing → Thinking → Speaking).

The Conversation endpoint uses your full knowledge vault, user profile, and connected MCP servers — the same context available in chat mode.

Requires HTTPS or localhost, plus configured STT and TTS providers.

> **Hardware:** The M5Stack ESP32 Atom Echo can serve as a standalone voice device — see [Installation](INSTALLATION.md#esp32-atom-echo-setup-optional).

---

## Dashboard Analytics

Select a **date range** to scope all metrics:

- **KPI cards** — Sessions, Engagement, Resolution, Escalation, Abandon, CSAT
- **Charts** — Errors & Activities, Sessions, Session Outcomes (click buckets to drill down)
- **Driver tables** — Topic-level contribution to resolution/escalation/abandon rates
