# Nexus Agent

**Self-hosted, multi-user AI agent** with autonomous knowledge capture, browser automation, voice interaction, and extensibility via MCP.

---

## Features

| Category | Highlights |
|----------|-----------|
| **AI & LLM** | Multi-provider orchestrator (Azure OpenAI, OpenAI, Anthropic, LiteLLM), intelligent task routing, worker-thread isolation, self-extending tools |
| **Knowledge** | Autonomous fact capture from conversations, semantic search, nightly dedup/maintenance |
| **Voice** | Speech-to-text (Whisper), text-to-speech (9 voices), hands-free conversation mode with VAD and interrupt support, local Whisper fallback, ESP32 Atom Echo hardware |
| **Channels** | Web chat, WhatsApp, Discord, email (SMTP+IMAP), custom webhooks |
| **Automation** | Playwright browser tools, file system tools, Alexa Smart Home (14 tools), background scheduler with proactive intelligence |
| **Safety** | Human-in-the-loop (default-deny), standing orders, prompt injection defense, CSP headers, rate limiting |
| **Multi-User** | Per-user knowledge, threads, channels, profiles. Role-based access (admin/user) with granular permissions |
| **Observability** | Analytics dashboard with KPIs, session trends, drilldown logs. Unified scheduler console with run history |

---

## Quick Start

```bash
npm install
npx playwright install chromium
cp .env.example .env   # set NEXTAUTH_SECRET
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The first user to sign in becomes the **admin**.

> See [Installation Guide](docs/INSTALLATION.md) for full setup and deployment instructions.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, Sense-Think-Act loop, data flow diagram |
| [Technical Specifications](docs/TECH_SPECS.md) | Database schema, API routes, security details |
| [Installation Guide](docs/INSTALLATION.md) | Prerequisites, environment variables, deployment |
| [Usage Handbook](docs/USAGE.md) | Getting started, workflows, configuration, admin ops |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js v20+, TypeScript 5.x |
| Frontend | Next.js 16, Material UI (MUI v7), TailwindCSS |
| Database | SQLite (`better-sqlite3`) with in-memory caching |
| LLM | Azure OpenAI, OpenAI, Anthropic, LiteLLM — native SDKs |
| Browser | Playwright (Chromium) |
| Auth | NextAuth v4 (credentials + OAuth) |
| Extensibility | MCP v1.26+ (Stdio, SSE, Streamable HTTP) |
| Testing | Jest (1547 tests, 124 suites) |

---

## Deployment

```bash
bash deploy.sh <host> <user>
```

Automated pipeline: version bump → tests → build → tarball → remote DB backup → upload → install → restart → health check. The production database is never overwritten.

---

## License

See [LICENSE](LICENSE) for details.
