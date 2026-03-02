# Nexus Agent

**Self-hosted, multi-user Proactive AI Agent** with deep memory, browser automation, file-system tools, and extensibility through the Model Context Protocol (MCP).

---

## Key Features

- **Multi-User Isolation** — per-user knowledge, threads, channels, and profiles
- **Proactive Intelligence** — background scheduler monitors MCP tools and generates reminders
- **Autonomous Knowledge Capture** — every conversation is mined for durable facts
- **Human-in-the-Loop (HITL)** — sensitive tool calls require explicit approval
- **Browser Automation** — Playwright-powered web navigation, form filling, and screenshots
- **Multi-Channel** — Web chat, WhatsApp, Discord, and custom webhooks
- **Two-Way Email Channel** — SMTP send + IMAP receive with shared inbox routing
- **Notification Severity Thresholds** — each user controls which alert levels trigger channel notifications
- **Screen Sharing** — share your screen with the agent for visual reasoning
- **Model Orchestrator** — intelligent task routing picks the best LLM (local for background, cloud for complex)
- **Self-Extending Tools** — the agent can create its own tools at runtime, compiled and sandboxed
- **Admin Notifications via Channels** — approval/proactive notices prefer IM channels, fallback to email
- **Security Hardened** — prompt injection defense, CSP headers, rate limiting, input validation
- **Email Injection Hardening** — inbound email content is handled as untrusted data and guarded before agent processing
- **Alexa Smart Home** — native integration with 14 Alexa tools for announcements, light/volume control, sensors, and DND management

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

```bash
npm run build
npm start                         # local production
```

For remote hosts:

```bash
tar -cf deploy.tar --exclude=node_modules --exclude=.git --exclude='*.db' .
scp deploy.tar user@host:/path/to/app/
# On remote: tar -xf deploy.tar && npm install --production && npx next start -p 3000
```

> **Important:** Exclude `*.db` files to avoid overwriting the remote database. See [Installation Guide](docs/INSTALLATION.md#remote-deployment) for details.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, Sense-Think-Act loop, architecture diagram, multi-user model |
| [Technical Specifications](docs/TECH_SPECS.md) | Tech stack, database schema, API routes, security details |
| [Installation Guide](docs/INSTALLATION.md) | Prerequisites, environment variables, production build, remote deployment, migration |
| [Usage & Configuration](docs/USAGE.md) | UI walkthrough, LLM setup, MCP servers, channels, HITL, knowledge vault |

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
| Testing | Jest (unit/integration), Playwright (E2E across Desktop Chrome, Pixel 7, iPhone 16 Pro Max) |

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
