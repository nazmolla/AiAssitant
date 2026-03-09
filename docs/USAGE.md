# Nexus Agent — Usage Handbook (Overview)

> Back to [README](../README.md) | [Architecture](ARCHITECTURE.md) | [Tech Specs](TECH_SPECS.md) | [Installation](INSTALLATION.md)

---

This handbook is split into one overview and multiple drill-down guides so users can move from quick orientation to deep task-specific instructions.

All screenshots are captured from the **test environment**.

## Typed Filtering Behavior

- Chat thread lists show only interactive threads based on DB type metadata (not title text conventions).
- Proactive and channel/system threads are persisted with explicit non-interactive types and remain excluded from regular chat lists.
- Knowledge Vault source filters use explicit `source_type` metadata (`manual` / `chat` / `proactive`).

## Runtime Log Streaming

- Use `GET /api/logs/stream` for live SSE log events (`log`, `cursor`, `heartbeat`).
- Access is allowed for admin sessions or API keys granted the `logs` scope.
- Optional query params: `sinceId`, `level`, `source`.
- Permanent CLI consumer script: `npm run logs:stream -- <baseUrl> <apiKey> [level] [source] [sinceId]`.

## DB Management Center

- Use **Settings → DB Management** (admin-only) to monitor DB growth and cleanup status in one location.
- Includes table-level breakdown, managed storage totals (DB/WAL/SHM/attachments), and host resource snapshot (CPU/RAM/uptime).
- Supports manual cleanup runs and recurring maintenance policies for logs, conversations/threads, attachments, and orphan files.

## Approval Notifications

- Approval notifications now show **structured details**: the action (in readable language), the item being acted on, the location, the reason for the request, and who/what initiated it (User Chat, Scheduled Task, etc.).
- **Default-deny** policy: unknown tools (no policy entry) always require approval — both in the agent chat loop and the gatekeeper.
- **Voice conversations** exclude any tool that requires approval — the LLM will not attempt tool calls that cannot be approved mid-call.

## Standing Orders

- Use **Settings → Standing Orders** to view, edit, or revoke your saved approval decisions.
- Standing orders are created when you choose **Always Allow**, **Always Ignore**, or **Always Reject** on an approval notification.
- Each standing order has a tool name, action, device, and reason signature. Future tool calls matching the signature are automatically resolved per your decision.
- You can change a standing order's decision (e.g., switch from "Always Allow" to "Always Reject"), delete individual orders, or clear all orders at once.

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
| [Daily Workflows](USAGE_DAILY_WORKFLOWS.md) | End users | Chat, notifications, knowledge, profile-level use |
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
3. **Speak naturally** — Nexus uses Voice Activity Detection (VAD) to automatically detect when you finish speaking (1.2s of silence after at least 0.4s of speech).
4. Your speech is transcribed, sent to the LLM, and the response is spoken back to you.
5. After Nexus finishes speaking, it automatically starts listening again for your next input.

### Features

- **Auto-listen mode**: After Nexus responds, it automatically resumes listening. Toggle between "Auto" and "Manual" via the chip in the header.
- **Voice selection**: Choose from 9 TTS voices (Alloy, Ash, Coral, Echo, Fable, Onyx, Nova, Sage, Shimmer) via the dropdown in the header.
- **Visual transcript**: The conversation is displayed as chat bubbles with the LLM response streamed in real-time with a typing cursor.
- **Audio level visualizer**: An animated bar graph shows microphone input levels during listening.
- **Status indicators**: Shows current state — Listening, Transcribing, Thinking, Speaking, or Ready.
- **Clear conversation**: After stopping, use "Clear conversation" to start fresh with a new thread.
- **Interrupt / Barge-in**: Start speaking while Nexus is thinking or responding to immediately interrupt it. Nexus will stop what it's doing and start listening to you. Interrupted responses are marked with a "⸺" indicator in the transcript. Uses a separate mic stream with a 200 ms sustained-speech threshold (at 2× sensitivity to avoid TTS bleed).
- **Stop button**: Tap the red stop button at any time to end the conversation immediately.

### Requirements

- HTTPS or localhost (required by browsers for microphone access).
- A configured STT provider (OpenAI Whisper or local Whisper fallback).
- A configured TTS provider (OpenAI TTS-1).
- A configured LLM provider for chat responses.

### ESP32 Atom Echo (Hardware Voice)

For a dedicated hardware voice assistant, the M5Stack **Atom Echo** can be flashed with the Arduino sketch in `esp32/atom-echo-nexus/`. It uses **on-device micro-wake-up** for wake-word detection and connects to Nexus for STT, conversation, and TTS over HTTP. See [Installation — ESP32 Setup](INSTALLATION.md#esp32-atom-echo-setup-optional) and the [Atom Echo README](../esp32/atom-echo-nexus/README.md) for details.
