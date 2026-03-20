# Nexus Agent — Daily Workflows

> Back to [Usage Overview](USAGE.md) | [Getting Started](USAGE_GETTING_STARTED.md) | [Troubleshooting](USAGE_TROUBLESHOOTING.md)

---

> **Summary:** How to use chat, approvals, knowledge, voice, and scheduled tasks in your daily workflow.

---

## Chat

Use the **Chat** tab for day-to-day AI interactions.

- **Welcome screen** — When no thread is selected, type your message and press Enter (or click Send). A thread is created automatically and your message is sent in one step.
- Start or select a thread, then send messages
- Responses stream in real-time with intermediate thinking steps visible
- Every response shows an "Analyzing…" block revealing the agent's process (model selection, knowledge retrieval, tool calls)
- Expand "Thought for N steps" to see full reasoning and tool results
- Attach files or share your screen when needed
- **Voice input** — Click 🎤 to dictate (transcribed via Whisper)
- **Voice output** — Click 🔊 on any response to hear it read aloud. Choose your voice in Settings → Profile

![Chat tab](images/usage-chat.png)

---

## Approvals

When a tool action requires approval:

1. The assistant pauses and shows the request inline
2. The request also appears in the **notification bell** (top-right)
3. Approve or reject — the assistant continues based on your decision
4. Choose **Always Allow/Reject** to save as a Standing Order for future calls

**Proactive approvals** from the background scheduler appear in the notification bell with a "Proactive" badge (admin-visible only).

> **Note:** The notification bell only shows notifications at or above your **Notification Level** threshold (Settings → Profile → Notification Level). If you are not seeing expected notifications, check that your threshold is set low enough. "Mark all as read" clears the bell entirely — all notifications remain in Dashboard → Logs.

![Approvals](images/usage-approvals.png)

---

## Scheduled Tasks

Ask the agent to do something later or on a schedule:

| Example | Type |
|---------|------|
| "Remind me tomorrow to check logs" | One-time |
| "Every day review pending approvals" | Daily recurring |
| "In 2 hours send a status update" | One-time delay |

Supported frequencies: hourly, daily, weekly, monthly, or specific delays (`in N hours/days`). Recurring tasks recalculate the next run after each execution.

---

## Knowledge

The **Knowledge** tab manages your personal fact vault.

- Search, add, edit, or delete entries
- Facts are automatically captured from conversations
- Sources are tagged: `manual`, `chat`, or `proactive`

![Knowledge tab](images/usage-knowledge.png)

---

## Profile

Access from **Account menu (top-right) → Profile** or **Settings → Profile**:

- Update personal information, skills, and links (display name is shown live in the header — changes appear immediately on next page load)
- Set **Notification Level** (`low` / `medium` / `high` / `disaster`) — controls which notifications appear in the bell **and** trigger external channel alerts (email, Discord, WhatsApp)
- Choose TTS voice and theme preferences

![Profile settings](images/usage-settings-profile.png)
