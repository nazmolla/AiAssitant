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

OpenAI-compatible chat providers (OpenAI and LiteLLM) also support **Disable Thinking (faster)**, which sends `think=false` when supported by the upstream model gateway.

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

Each discovered tool has two key controls:

- `requires_approval` — whether the tool needs human approval before execution
- `scope` — **Global** (available to all users) or **User Only** (admin-only, hidden from non-admin users)

The proactive scheduler can use any tool — only `requires_approval` gates whether human approval is needed before execution.

Includes global **Expand all / Collapse all** controls. Summary bar shows tool count, groups, approval count, and user-only count.

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
- **faster-whisper-server** — Python, CTranslate2 + CUDA, ideal for GPU devices
- **whisper.cpp** — C++, CUDA support, lightweight

---

## Audio Mode (Conversation Tab)

Hands-free conversation mode — talk to Nexus without clicking buttons.

Activation:
1. Open the **Conversation** tab
2. Click the **microphone** button to start
3. Recording starts and VAD detects end-of-speech automatically
4. Nexus transcribes, processes, and speaks the response
5. Auto mode resumes listening after playback; use **Manual/Auto** toggle as needed
6. Click **Stop** to end the session

The status banner shows the current phase: Listening → Transcribing → Thinking → Speaking.
