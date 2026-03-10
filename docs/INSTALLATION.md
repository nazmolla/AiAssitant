# Nexus Agent — Installation Guide

> Back to [README](../README.md) | [Architecture](ARCHITECTURE.md) | [Tech Specs](TECH_SPECS.md) | [Usage](USAGE.md)

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **Node.js** | v20+ (LTS). Tested on x86-64 and ARM64. |
| **npm** | Bundled with Node.js |
| **LLM API key** | Configure at runtime via Settings → LLM Providers |
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
# Edit .env with NEXTAUTH_SECRET (LLM keys and OAuth are configured via the admin UI)

# 5. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the Command Center.

> **First-time setup:** The first user to sign in (via email + password or OAuth) automatically becomes the **admin**. Subsequent users receive the **user** role. Each user gets isolated knowledge, threads, and profile settings.

### Post-Setup Validation (Recommended)

```bash
npx jest --forceExit
```

Then open the **Dashboard** tab and verify:

- KPI analytics cards are visible
- Errors/Activities and Sessions charts render
- Clicking a chart bucket drills down to detail logs
- Log entries show full date + time

If you plan to use automated job scouting and resume delivery by email, also verify:

- At least one **Email** channel is configured and enabled in Settings.
- Your profile includes current role history, core skills, and location preferences for accurate resume tailoring.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXTAUTH_SECRET` | Yes | Random secret for JWT signing. Generate with `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | Yes | Base URL (e.g., `http://localhost:3000`) |
| `DATABASE_PATH` | No | SQLite database file path (default: `nexus.db`) |
| `PROACTIVE_CRON_SCHEDULE` | No | Cron expression for the proactive scheduler (default: every 15 min) |

Knowledge maintenance settings are managed in the admin UI via **Settings → Scheduler** and stored in `app_config`.
The same page also includes the unified scheduler operations console (overview metrics, schedule controls, run history, and task-run detail).

> **LLM keys, OAuth providers, and Discord credentials** are no longer set in `.env`. Configure them at runtime through the admin UI — see [Usage Configuration](USAGE_CONFIGURATION.md#llm-providers) and [Admin Operations](USAGE_ADMIN.md#authentication-providers).

---

## Production Build

```bash
# Build the optimized production bundle (Turbopack not supported — use webpack)
npx next build --webpack

# Start the production server
npm start
```

## Schema Migration Note

On startup, DB initialization now backfills typed metadata columns for legacy data:

- `threads.thread_type`, `threads.is_interactive`, `threads.channel_id`, `threads.external_sender_id`
- `user_knowledge.source_type`

Scheduler initialization also provisions unified scheduler foundation tables:

- `scheduler_schedules`
- `scheduler_tasks`
- `scheduler_runs`
- `scheduler_task_runs`
- `scheduler_claims`
- `scheduler_events`

Legacy `scheduled_tasks` rows are backfilled into `scheduler_schedules` + `scheduler_tasks` during startup to support phased migration without losing scheduled intent.

This migration replaces legacy title/source prefix parsing in runtime filters.

DB maintenance policies are persisted in `app_config` and can be managed through **Settings → DB Management** (admin-only). This includes recurring cleanup interval, retention windows, and cleanup toggles for logs, threads/conversations, attachments, and orphan files.

By default, the server listens on port `3000`. Override with `-p`:

```bash
npx next start -p 3000
```

---

## Remote Deployment

Use the project deployment script for production releases:

```bash
# From Git Bash on Windows (required — PowerShell SSH causes false failures)
bash deploy.sh <host> <user>

# Example
bash deploy.sh <host> <user>
```

The script performs: version bump → Jest tests → webpack build → gzip tarball (excluding DB/data) → remote DB backup → scp upload → extract → npm install → service restart → HTTPS health verification → DB integrity check.

**Deploy script design notes:**
- All remote commands use discrete SSH calls with `-o LogLevel=ERROR` to suppress post-quantum key-exchange warnings that cause false exit codes on Windows
- The production database `nexus.db` is **never** overwritten — it is excluded from the tarball and protected during extraction
- Tarball is uploaded to `/tmp/` then extracted to minimize downtime

> **Critical:** Do not manually package/copy/deploy app files for production. Always use `deploy.sh` via Git Bash. The production database (`nexus.db`) must never be overwritten.

### Memory-Constrained Devices

On devices with limited RAM (4 GB or less), set the Node.js heap limit:

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
WorkingDirectory=/home/user/nexus-agent
ExecStart=/usr/bin/node node_modules/.bin/next start -p 3000
Environment=NODE_OPTIONS=--max-old-space-size=256
User=user
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

## Local Whisper Setup (Optional)

Deploy a local Whisper STT server as a fallback when cloud speech-to-text is unavailable. Uses [whisper.cpp](https://github.com/ggerganov/whisper.cpp) with the OpenAI-compatible `/inference` endpoint.

### Build from Source

```bash
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
git checkout v1.5.5
```

**GCC 8 on aarch64:** Apply the NEON intrinsic patch first — GCC 8 has a bug where `vld1q_{s8,u8}_x{2,4}` returns `int` instead of the correct struct types. Upload and run `patch-whisper.py` from the repo root to fix this automatically.

```bash
make -j$(nproc) server
```

### Download Model

```bash
bash models/download-ggml-model.sh small   # 466 MB — good balance of speed/accuracy
# Other options: tiny (75 MB), base (142 MB), medium (1.5 GB)
```

### Run as a Service

```ini
# /etc/systemd/system/whisper.service
[Unit]
Description=Whisper.cpp STT Server (small model)
After=network.target

[Service]
Type=simple
User=<user>
WorkingDirectory=/home/<user>/whisper.cpp
ExecStart=/home/<user>/whisper.cpp/server -m /home/<user>/whisper.cpp/models/ggml-small.bin --host 0.0.0.0 --port 8083 -t 4
Restart=on-failure
RestartSec=5
Environment=MALLOC_ARENA_MAX=2

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable whisper && sudo systemctl start whisper
```

### Configure in Nexus

Go to **Settings → Local Whisper** and set:
- **Enabled**: On
- **URL**: `http://localhost:8083`
- **Model**: `ggml-small`

Click **Test Connection** to verify, then **Save**.

Nexus will automatically fall back to the local server when the cloud STT provider fails. The fallback tries `/v1/audio/transcriptions` first (faster-whisper-server), then `/inference` (whisper.cpp).

---

## Migration from Single-User

If upgrading from a previous single-owner installation, the database migration runs **automatically on first startup**:

1. Creates an admin user from the existing `identity_config` data
2. Back-fills `user_id` on all existing `user_knowledge` and `threads` rows
3. Migrates `owner_profile` data to the new `user_profiles` table
4. Legacy tables (`identity_config`, `owner_profile`) are preserved for compatibility

No manual steps required — the migration is **idempotent** and safe to run multiple times.

---

## HTTPS Setup (Required for Voice Input)

The browser's `getUserMedia` API (microphone access) requires a **secure context** — HTTPS or localhost. For network access (e.g., `https://<host>`), you must serve over HTTPS.

The recommended approach uses **nginx** as an HTTPS reverse proxy in front of Next.js.

### Automated Setup

Run the provided setup script on the server:

```bash
bash scripts/setup-https.sh
```

This script:
1. Generates a self-signed SSL certificate (10-year validity) at `/etc/nginx/ssl/`
2. Configures nginx to proxy `HTTPS:443 → Next.js:3000`
3. Enables HTTP → HTTPS redirect
4. Supports SSE streaming, WebSocket upgrade, and 30 MB file uploads

### Manual Setup

If you prefer manual configuration:

```bash
# Generate self-signed cert
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/nexus.key -out /etc/nginx/ssl/nexus.crt \
  -subj '/CN=YOUR_IP/O=Nexus Agent' \
  -addext 'subjectAltName=IP:YOUR_IP'

# Place the nginx config (see scripts/setup-https.sh for the full config)
sudo cp nexus-agent.conf /etc/nginx/sites-available/nexus-agent
sudo ln -sf /etc/nginx/sites-available/nexus-agent /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

> **Note:** Self-signed certificates trigger a browser warning. Accept the certificate once per browser/device. After accepting, all features including microphone access will work.

### Access

After setup, access the app at `https://YOUR_IP` (port 443, no port needed in URL).

---

## ESP32 Atom Echo Setup (Optional)

The M5Stack Atom Echo can be set up as a standalone hands-free voice assistant for Nexus.

1. Open `esp32/atom-echo-nexus/atom_echo_nexus.ino` in the Arduino IDE (or PlatformIO).
2. Set your WiFi credentials, Nexus host/port, and API key in the `CONFIG` section.
3. Install the **micro-wake-up** library and place a wake-word model in the project.
4. Upload the sketch to the Atom Echo.

See [`esp32/atom-echo-nexus/README.md`](../esp32/atom-echo-nexus/README.md) for full hardware details, pin assignments, and wake-word configuration.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `better-sqlite3` build fails | Ensure `node-gyp` and build tools are installed: `npm install -g node-gyp` |
| Playwright launch fail on Linux | Run `npx playwright install-deps chromium` to install system libraries |
| Port already in use | Change port with `npx next start -p <port>` or stop the existing process |
| ARM64 native modules | Run `npm install` on the target device to rebuild native addons for the correct architecture |
| Database locked errors | Ensure only one instance of the server is running against the same `nexus.db` file |
| Mic button doesn't work | `getUserMedia` requires HTTPS. Set up nginx HTTPS proxy — see [HTTPS Setup](#https-setup-required-for-voice-input) |
| nginx 502 Bad Gateway | Ensure `nexus-agent` systemd service is running: `sudo systemctl status nexus-agent` |
| Certificate warning in browser | Expected for self-signed certs. Click "Advanced" → "Proceed" to accept |
