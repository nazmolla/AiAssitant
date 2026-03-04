# Nexus Agent — Usage Handbook (Overview)

> Back to [README](../README.md) | [Architecture](ARCHITECTURE.md) | [Tech Specs](TECH_SPECS.md) | [Installation](INSTALLATION.md)

---

This handbook is split into one overview and multiple drill-down guides so users can move from quick orientation to deep task-specific instructions.

All screenshots are captured from the **test environment**.

## Reading Path

1. **Start here:** [USAGE_GETTING_STARTED.md](USAGE_GETTING_STARTED.md)
2. **Daily user tasks:** [USAGE_DAILY_WORKFLOWS.md](USAGE_DAILY_WORKFLOWS.md)
3. **Runtime setup/config:** [USAGE_CONFIGURATION.md](USAGE_CONFIGURATION.md)
4. **Admin-only operations:** [USAGE_ADMIN.md](USAGE_ADMIN.md)
5. **Issues and fixes:** [USAGE_TROUBLESHOOTING.md](USAGE_TROUBLESHOOTING.md)

---

## Information Architecture

| Guide | Audience | Scope |
|------|----------|-------|
| [Getting Started](USAGE_GETTING_STARTED.md) | Everyone | Sign-in, navigation, first successful flow |
| [Daily Workflows](USAGE_DAILY_WORKFLOWS.md) | End users | Chat, approvals, knowledge, profile-level use |
| [Configuration](USAGE_CONFIGURATION.md) | Operators / advanced users | LLM, MCP, tool policies, channels, Alexa |
| [Admin Operations](USAGE_ADMIN.md) | Admins | Users, auth providers, custom tool governance |
| [Troubleshooting](USAGE_TROUBLESHOOTING.md) | Everyone | Common issues, diagnostics, recovery steps |

---

## UI Snapshot

![Command Center overview (test env)](images/usage-command-center-overview.png)

---

## Analytics Dashboard (New)

The **Dashboard** tab provides a full analytics view built from runtime logs and session metadata.

### What You Can Do

- Select a **date range** to scope all metrics and charts.
- Monitor KPI cards: **Sessions**, **Engagement**, **Resolution**, **Escalation**, **Abandon**, **CSAT**. Sessions are counted from logs that contain session metadata (e.g. `sessionId`, `threadId`, `conversationId`) — standalone events without session IDs are excluded.
- Use **Errors & Activities** chart bucket click to drill into detailed logs.
- Use **Sessions** chart bucket click to drill into session-associated details.
- Track **Session Outcomes Over Time** (resolved/escalated/abandoned).
- Review **driver tables** that show topic-level contribution to resolution/escalation/abandon rates.

### Drilldown Behavior

- Clicking a chart bucket applies a temporary filter to the detail stream.
- Drilldown can be cleared from the chip shown under the chart header.
- Detail rows show **full date and time** for each log entry.

## Conversation Mode (Voice)

The **Conversation** tab provides a dedicated full-screen voice conversation experience, separate from the text chat.

### How It Works

1. Navigate to the **Conversation** tab from the sidebar.
2. Tap the **microphone button** to start a voice conversation.
3. **Speak naturally** — Nexus uses Voice Activity Detection (VAD) to automatically detect when you finish speaking (1.8s of silence after speech).
4. Your speech is transcribed, sent to the LLM, and the response is spoken back to you.
5. After Nexus finishes speaking, it automatically starts listening again for your next input.

### Features

- **Auto-listen mode**: After Nexus responds, it automatically resumes listening. Toggle between "Auto" and "Manual" via the chip in the header.
- **Voice selection**: Choose from 9 TTS voices (Alloy, Ash, Coral, Echo, Fable, Onyx, Nova, Sage, Shimmer) via the dropdown in the header.
- **Visual transcript**: The conversation is displayed as chat bubbles with the LLM response streamed in real-time with a typing cursor.
- **Audio level visualizer**: An animated bar graph shows microphone input levels during listening.
- **Status indicators**: Shows current state — Listening, Transcribing, Thinking, Speaking, or Ready.
- **Clear conversation**: After stopping, use "Clear conversation" to start fresh with a new thread.
- **Stop button**: Tap the red stop button at any time to end the conversation immediately.

### Requirements

- HTTPS or localhost (required by browsers for microphone access).
- A configured STT provider (OpenAI Whisper or local Whisper fallback).
- A configured TTS provider (OpenAI TTS-1).
- A configured LLM provider for chat responses.
