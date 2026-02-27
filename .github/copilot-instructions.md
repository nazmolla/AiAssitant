# Copilot Project Rules — Nexus Agent

## Deployment

- **NEVER deploy manually.** Always use `deploy.sh` via Git Bash: `bash deploy.sh YOUR_SERVER_IP jetson`
- Do NOT manually create tarballs, scp files, or run remote commands to deploy.
- `deploy.sh` handles: version bump, tests, build, tarball (excluding DB), DB backup, upload, extraction, npm install, restart, and HTTP verification — in the correct safe order.
- The production database (`nexus.db`) must NEVER be overwritten, copied, or transferred. It lives only on the Jetson and is excluded from all tarballs.

## Local Server

- **NEVER start a local dev server.** Do not run `next dev`, `next start`, or any server locally.
- The only deployment target is the Jetson at `YOUR_SERVER_IP:3000`.

## Testing

- Always run `npx jest --forceExit` before deploying.
- After deployment, verify the Jetson responds with HTTP 200 and check `journalctl -u nexus-agent` for errors.
