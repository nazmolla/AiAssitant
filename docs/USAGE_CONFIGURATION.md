# Nexus Agent — Configuration Guide

> Back to [Usage Overview](USAGE.md) | [Admin Operations](USAGE_ADMIN.md)

---

This guide covers runtime setup areas in **Settings**.

## LLM Providers

Configure chat and embedding providers and select defaults.

![Providers settings (test env)](images/usage-settings-providers.png)

| Provider | Typical Inputs |
|----------|----------------|
| Azure OpenAI | API key, endpoint, deployment/model |
| OpenAI | API key, model |
| Anthropic | API key, model |

Nexus routes tasks via the orchestrator (complex/simple/background/vision) based on capability and tier.

---

## MCP Servers

Add servers, connect, and discover tools.

![MCP settings (test env)](images/usage-settings-mcp.png)

| Transport | Typical Endpoint |
|-----------|------------------|
| Stdio | Local command + args |
| SSE | `http://host:port/.../sse` |
| Streamable HTTP | `http://host:port/...` |

Scopes:
- **Global** (shared)
- **User** (owner-only)

**Auto-refresh:** When a connected MCP server installs or removes tools at runtime (e.g. Forage), the agent detects the `list_changed` notification and refreshes the tool list automatically — no restart or manual reconnect needed.

---

## Tool Policies (HITL + Proactive)

Each discovered tool has three key controls:

- `requires_approval` — whether the tool needs human approval before execution
- `is_proactive_enabled` — whether the proactive scheduler can invoke this tool
- `scope` — **Global** (available to all users) or **User Only** (admin-only, hidden from non-admin users)

Includes global **Expand all / Collapse all** controls. Summary bar shows tool count, groups, approval count, proactive count, and user-only count.

![Tool Policies settings (test env)](images/usage-settings-tool-policies.png)

---

## Channels

Configure inbound/outbound integrations.

![Channels settings (test env)](images/usage-settings-channels.png)

| Type | Purpose |
|------|---------|
| WhatsApp | Webhook messaging integration |
| Discord | Bot-based interaction (mentions/DM/slash) |
| Email | Two-way SMTP + IMAP |
| Webhook | Generic inbound API endpoint |

---

## Alexa Smart Home

Native Alexa integration with 14 built-in tools.

![Alexa settings (test env)](images/usage-settings-alexa.png)

Setup:
1. Open **Settings → Alexa**
2. Save `UBID_MAIN` and `AT_MAIN`
3. Manage approvals/proactive behavior in Tool Policies

---

## Local Whisper (Admin)

Deploy a local Whisper server as a fallback for cloud Speech-to-Text. When the cloud STT provider fails, Nexus automatically retries via the local server.

Setup:
1. Open **Settings → Local Whisper**
2. Enable the fallback toggle
3. Enter the server URL (e.g. `http://localhost:8083`)
4. Set the model name (e.g. `large-v3`, `small`, `whisper-1`)
5. Click **Test Connection** to verify
6. Click **Save Configuration**

The local Whisper server must expose an OpenAI-compatible `/v1/audio/transcriptions` endpoint. Recommended servers:
- **faster-whisper-server** — Python, CTranslate2 + CUDA, ideal for Jetson
- **whisper.cpp** — C++, CUDA support, lightweight

---

## Audio Mode (Chat)

Hands-free conversation mode — talk to Nexus without clicking buttons.

Activation:
1. Click the **headset icon** (🎧) in the chat input bar
2. Recording starts automatically
3. After you stop speaking, Nexus transcribes, processes, and speaks the response
4. After the response finishes playing, recording auto-starts again
5. Click the headset icon again (or the "Stop" button in the status banner) to exit

The status banner shows the current phase: Listening → Transcribing → Thinking → Speaking.
