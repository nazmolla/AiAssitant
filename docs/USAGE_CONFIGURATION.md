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

---

## Tool Policies (HITL + Proactive)

Each discovered tool has two key controls:

- `requires_approval`
- `is_proactive_enabled`

Includes global **Expand all / Collapse all** controls.

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
