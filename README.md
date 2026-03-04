# Nexus Agent

**Self-hosted, multi-user Proactive AI Agent** with deep memory, browser automation, file-system tools, and extensibility through the Model Context Protocol (MCP).

---

## Key Features

- **Multi-User Isolation** — per-user knowledge, threads, channels, and profiles
- **Proactive Intelligence** — background scheduler monitors MCP tools, creates custom tools for automation opportunities, and generates reminders; schedule configurable via Settings → Scheduler
- **Scheduled Task Queue** — future and recurring tasks are persisted with frequency, next run, last run, source, and scope; executed automatically by the background scheduler
- **Autonomous Knowledge Capture** — every conversation is mined for durable facts
- **Human-in-the-Loop (HITL)** — sensitive tool calls require explicit approval; all approvals, system errors, and proactive actions surface in the **Notification Center** (bell icon in the top bar); per-tool **scope** (Global or User Only) controls visibility
- **Browser Automation** — Playwright-powered web navigation, form filling, and screenshots
- **Multi-Channel** — Web chat, WhatsApp, Discord, and custom webhooks
- **Two-Way Email Channel** — SMTP send + IMAP receive with shared inbox routing
- **Notification Severity Thresholds** — each user controls which alert levels trigger channel notifications; smart home/IoT tools are automatically capped below `disaster`
- **Full Analytics Dashboard** — date-range KPIs, sessions graph, outcomes trends, and chart drilldown to detailed logs
- **Screen Sharing** — share your screen with the agent for visual reasoning
- **Audio Mode** — hands-free conversation with auto-listen and streaming TTS; continuous talk→transcribe→respond→speak loop
- **Conversation Tab (Voice-First)** — dedicated voice workflow with VAD auto-stop, interrupt/barge-in, and streamed responses
- **Local Whisper Fallback** — optional local Whisper server (faster-whisper-server or whisper.cpp) as automatic STT backup when cloud fails
- **Model Orchestrator** — intelligent task routing picks the best LLM (local for background, cloud for complex)
- **No-Thinking Provider Option** — OpenAI-compatible chat providers (OpenAI/LiteLLM) can force `think=false` for faster responses when supported
- **Worker Thread Isolation** — LLM API calls run in a dedicated Worker Thread to keep the main event loop responsive; automatic fallback if unavailable
- **Self-Extending Tools** — the agent can create its own tools at runtime, compiled and sandboxed
- **Account Dropdown** — top-right user menu provides quick **Profile** and **Sign out** actions
- **Unified Notification Center** — bell icon in the header aggregates approvals, tool errors, proactive actions, channel errors and system alerts; IM channels + email fallback for external delivery
- **Security Hardened** — prompt injection defense, CSP headers, rate limiting, input validation
- **Email Injection Hardening** — inbound email content is handled as untrusted data and guarded before agent processing
- **Alexa Smart Home** — native integration with 14 Alexa tools for announcements, light/volume control, sensors, and DND management
- **ESP32 Atom Echo** — standalone Arduino sketch for M5Stack Atom Echo with on-device wake-word detection (micro-wake-up) and hands-free voice interaction
- **Multi-Format TTS** — configurable TTS output format (mp3, wav, pcm, opus, aac, flac) for flexible client support

---

## Quick Start

```bash
npm install
npx playwright install chromium
cp .env.example .env   # configure API keys + NEXTAUTH_SECRET
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The first user to sign in becomes the **admin**.

> See [Installation Guide](docs/INSTALLATION.md) for full setup, environment variables, and remote deployment.

---

## Deployment

Production deployment is performed via the project deployment script:

```bash
bash deploy.sh <host> <user>
```

The script handles tests, build, safe packaging, remote DB backup, install, restart, and HTTPS verification. It also excludes `*.db` files so the production database is never overwritten.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, Sense-Think-Act loop, architecture diagram, multi-user model |
| [Technical Specifications](docs/TECH_SPECS.md) | Tech stack, database schema, API routes, security details |
| [Installation Guide](docs/INSTALLATION.md) | Prerequisites, environment variables, production build, remote deployment, migration |
| [Usage Handbook](docs/USAGE.md) | Overview + drill-down guides: getting started, daily workflows, configuration, admin operations, troubleshooting |

### Analytics Overview

The **Dashboard** tab now provides analytics views for operations and reliability:

- Date-range scoped metrics (sessions, engagement, resolution, escalation, abandon, CSAT)
- Errors vs Activities trend with clickable bucket drilldown into log details
- Sessions trend with session-scoped drilldown into details
- Session outcomes trend (resolved/escalated/abandoned)
- Driver tables for resolution, escalation, and abandon rates

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js v20+, TypeScript 5.x |
| Frontend | Next.js 14, Material UI (MUI v7), TailwindCSS |
| Database | SQLite (`better-sqlite3`) |
| LLM | Azure OpenAI, OpenAI, Anthropic, LiteLLM (native SDKs + orchestrator) |
| Browser | Playwright (Chromium) |
| Auth | NextAuth v4 (credentials + OAuth) |
| Extensibility | MCP v1.26+ (Stdio, SSE, Streamable HTTP) |
| Testing | Jest (unit/integration/component — 839 tests, 69 suites), Playwright (E2E across Desktop Chrome, Pixel 7, iPhone 16 Pro Max) |

---

## Testing

```bash
npm test              # Jest unit & integration tests
npm run test:e2e      # Playwright E2E smoke tests (requires production build)
npm run test:all      # Both Jest and Playwright
```

Playwright tests run against a production build on 4 device profiles: Desktop Chrome, Pixel 7, iPhone 16 Pro Max (portrait & landscape).

---

## License

See [LICENSE](LICENSE) for details.
