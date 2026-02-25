# Nexus Agent — Installation Guide

> Back to [README](../README.md) | [Architecture](ARCHITECTURE.md) | [Tech Specs](TECH_SPECS.md) | [Usage](USAGE.md)

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **Node.js** | v20+ (LTS). Tested on x86-64 and ARM64 (Jetson Nano). |
| **npm** | Bundled with Node.js |
| **At least one LLM API key** | OpenAI, Azure OpenAI, or Anthropic |
| **OS** | Linux, macOS, or Windows. ARM64 support for edge devices. |

---

## Quick Start

```bash
# 1. Clone the repository
git clone <repo-url> nexus-agent
cd nexus-agent

# 2. Install dependencies
npm install

# 3. Install Playwright for browser automation
npx playwright install chromium

# 4. Copy and configure environment variables
cp .env.example .env
# Edit .env with your API keys, NEXTAUTH_SECRET, and optional OAuth credentials

# 5. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the Command Center.

> **First-time setup:** The first user to sign in (via email + password or OAuth) automatically becomes the **admin**. Subsequent users receive the **user** role. Each user gets isolated knowledge, threads, and profile settings.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXTAUTH_SECRET` | Yes | Random secret for JWT signing. Generate with `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | Yes | Base URL (e.g., `http://localhost:3000`) |
| `OPENAI_API_KEY` | One LLM required | OpenAI API key |
| `AZURE_OPENAI_API_KEY` | One LLM required | Azure OpenAI key |
| `AZURE_OPENAI_ENDPOINT` | With Azure key | Azure OpenAI endpoint URL |
| `ANTHROPIC_API_KEY` | One LLM required | Anthropic API key |
| `AZURE_AD_CLIENT_ID` | Optional | Azure AD OAuth app client ID |
| `AZURE_AD_CLIENT_SECRET` | Optional | Azure AD OAuth app client secret |
| `AZURE_AD_TENANT_ID` | Optional | Azure AD tenant ID |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth client secret |
| `DISCORD_BOT_TOKEN` | Optional | Discord bot token for Gateway integration |
| `DISCORD_APPLICATION_ID` | Optional | Discord application ID for slash commands |

> You need **at least one** LLM API key (OpenAI, Azure OpenAI, or Anthropic). Additional providers can be added at runtime through the LLM Config panel.

---

## Production Build

```bash
# Build the optimized production bundle
npm run build

# Start the production server
npm start
```

By default, the server listens on port `3000`. Override with `-p`:

```bash
npx next start -p 8080
```

---

## Remote Deployment (e.g., Jetson Nano)

For deploying to a remote host (ARM64 or x86):

```bash
# 1. Build locally
npm run build

# 2. Package — IMPORTANT: exclude database files to avoid overwriting remote data
tar -cf deploy.tar \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=data \
  --exclude=.next/cache \
  --exclude='*.db' \
  --exclude='*.db-wal' \
  --exclude='*.db-shm' \
  .

# 3. Transfer to remote host
scp deploy.tar user@host:/path/to/app/

# 4. On the remote host — extract, install, and start
ssh user@host
cd /path/to/app
tar -xf deploy.tar
npm install --production
NODE_OPTIONS='--max-old-space-size=256' npx next start -p 3000
```

> **Critical:** The deploy tar **must exclude `*.db` files** to prevent overwriting the remote database with the local development copy. The remote host maintains its own `nexus.db` with user-configured LLMs, MCP servers, channels, and knowledge data.

### Memory-Constrained Devices

On devices with limited RAM (e.g., Jetson Nano with 4 GB), set the Node.js heap limit:

```bash
NODE_OPTIONS='--max-old-space-size=256' npx next start -p 3000
```

### Running as a System Service

Create a `systemd` unit file for automatic startup:

```ini
# /etc/systemd/system/nexus-agent.service
[Unit]
Description=Nexus Agent
After=network.target

[Service]
WorkingDirectory=/home/<user>/nexus-agent
ExecStart=/usr/bin/node node_modules/.bin/next start -p 3000
Environment=NODE_OPTIONS=--max-old-space-size=256
User=<user>
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable nexus-agent
sudo systemctl start nexus-agent
```

---

## Playwright Setup

Browser automation requires Playwright's Chromium browser:

```bash
npx playwright install chromium
```

On headless Linux servers, you may also need system dependencies:

```bash
npx playwright install-deps chromium
```

The agent uses a **persistent browser context** stored in `data/browser-profile/`, which preserves cookies and sessions across restarts.

---

## Migration from Single-User

If upgrading from a previous single-owner installation, the database migration runs **automatically on first startup**:

1. Creates an admin user from the existing `identity_config` data
2. Back-fills `user_id` on all existing `user_knowledge` and `threads` rows
3. Migrates `owner_profile` data to the new `user_profiles` table
4. Legacy tables (`identity_config`, `owner_profile`) are preserved for compatibility

No manual steps required — the migration is **idempotent** and safe to run multiple times.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `better-sqlite3` build fails | Ensure `node-gyp` and build tools are installed: `npm install -g node-gyp` |
| Playwright launch fail on Linux | Run `npx playwright install-deps chromium` to install system libraries |
| Port already in use | Change port with `npx next start -p <port>` or stop the existing process |
| ARM64 native modules | Run `npm install` on the target device to rebuild native addons for the correct architecture |
| Database locked errors | Ensure only one instance of the server is running against the same `nexus.db` file |
