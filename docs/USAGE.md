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
- Monitor KPI cards: **Sessions**, **Engagement**, **Resolution**, **Escalation**, **Abandon**, **CSAT**.
- Use **Errors & Activities** chart bucket click to drill into detailed logs.
- Use **Sessions** chart bucket click to drill into session-associated details.
- Track **Session Outcomes Over Time** (resolved/escalated/abandoned).
- Review **driver tables** that show topic-level contribution to resolution/escalation/abandon rates.

### Drilldown Behavior

- Clicking a chart bucket applies a temporary filter to the detail stream.
- Drilldown can be cleared from the chip shown under the chart header.
- Detail rows show **full date and time** for each log entry.
