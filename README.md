# Nexus Agent

**Self-hosted, multi-user Proactive AI Agent** with deep memory, browser automation, file-system tools, and extensibility through the Model Context Protocol (MCP).

---

## Key Features

- **Security and Performance Remediation (Mar 2026)** — path traversal guards hardened with separator-safe checks, webhook route now rate-limited by middleware (while preserving webhook secret auth), HSTS header enabled, attachment downloads streamed instead of full-buffer reads, knowledge search capped to bounded result sets, FS tool operations moved to async I/O, and log SSE DB polling reduced from 1s to 2s.
- **Multi-User Isolation** — per-user knowledge, threads, channels, and profiles
- **Proactive Intelligence** — background scheduler monitors MCP tools, creates custom tools for automation opportunities, and generates reminders; schedule configurable via Settings → Scheduler
- **Unified User Scheduling** — future and recurring user tasks are persisted as unified schedule/task records and executed by the unified scheduler engine
- **Unified Scheduler Foundation** — normalized scheduler tables (`scheduler_schedules`, `scheduler_tasks`, `scheduler_runs`, `scheduler_task_runs`, `scheduler_claims`, `scheduler_events`) are now in place for schedule/task graph modeling and run-history tracking
- **Unified Scheduler Console** — admin Settings → Scheduler now opens with a Header Tasks grid; selecting a header reveals inline child tasks + recent runs, and Focus View expands to full run history with run-log links
- **Unified Scheduler Migration** — proactive scans, DB maintenance, and knowledge maintenance are now represented as system schedules/tasks in the unified engine; Job Scout pipeline is modeled as a parent schedule with child tasks
- **Scheduler Reliability Guardrails** — enforced run/task-run transition rules, registered-handler validation, and scheduler health metrics API for queue/failure/stale-claim monitoring
- **Evening Knowledge Maintenance** — nightly dedupe/declutter for `user_knowledge` runs as a unified scheduler system task with configurable hour/minute and poll cadence
- **Autonomous Knowledge Capture** — every conversation is mined for durable facts
- **Human-in-the-Loop (HITL)** — default-deny policy enforcement with required rationale; interactive chat/voice approvals are requested inline in the same conversation; Approval Center is reserved for proactive/email-origin actions with structured details (action, item, location, reason, source); per-tool **scope** (Global or User Only) controls visibility
- **Standing Orders Management** — view, edit, and revoke saved approval decisions (Always Allow / Always Ignore / Always Reject) from Settings → Standing Orders
- **Browser Automation** — Playwright-powered web navigation, form filling, and screenshots
- **Large File Tooling** — `fs_read_file` supports byte-based chunked reads (`offset`/`length`) for multi-MB files, and `fs_extract_text` extracts readable text from large HTML/XML blobs
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
- **Profile Quick Access** — top-right avatar + name opens Profile directly, with dedicated sign-out button
- **Job Scout Workflow** — can discover matching roles (including LinkedIn listings), generate tailored resumes per role, and email job links with attached resumes
- **Unified Notification Center** — bell icon in the header aggregates approvals, tool errors, proactive actions, channel errors and system alerts; IM channels + email fallback for external delivery
- **DB Management Center** — dedicated Settings page for DB/table size breakdown, host resource snapshot (CPU/RAM/storage), manual cleanup tools, and recurring retention jobs
- **Security Hardened** — prompt injection defense, CSP headers, rate limiting, input validation
- **Email Injection Hardening** — inbound email content is handled as untrusted data and guarded before agent processing
- **Alexa Smart Home** — native integration with 14 Alexa tools for announcements, light/volume control, sensors, and DND management
- **ESP32 Atom Echo** — standalone Arduino sketch for M5Stack Atom Echo with on-device wake-word detection (micro-wake-up) and hands-free voice interaction
- **Multi-Format TTS** — configurable TTS output format (mp3, wav, pcm, opus, aac, flac) for flexible client support

## Data Model Update

- Thread visibility/routing no longer depends on parsing thread title text. It now uses typed columns: `thread_type`, `is_interactive`, `channel_id`, and `external_sender_id`.
- Knowledge source filtering no longer parses `source_context` prefixes; it now uses `user_knowledge.source_type` (`manual` | `chat` | `proactive`).

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

## CI And Branch Policy

- Required workflow: `.github/workflows/ci-quality-gate.yml`
- Required checks before merge to `main`:
	- Lint (`npm run lint`)
	- Jest suite (`npx jest --forceExit`)
	- Vulnerability audit (`npm audit --audit-level=moderate`)
- Enforce branch protection on `main`:
	- Require pull requests
	- Require at least 1 approval
	- Require status checks from CI Quality Gate
	- Restrict direct pushes to `main`

### Deployment Safety Controls

- Deterministic install in deploy: `npm ci`
- Smoke tests are blocking by default
- Emergency override only: set `DEPLOY_ALLOW_SMOKE_FAIL=1`

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
