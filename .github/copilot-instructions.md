# Copilot Project Rules — Nexus Agent

## Deployment

- **NEVER deploy manually.** Always use `deploy.sh` via Git Bash: `bash deploy.sh YOUR_SERVER_IP jetson`
- Do NOT manually create tarballs, scp files, or run remote commands to deploy.
- `deploy.sh` handles: version bump, tests, build, tarball (excluding DB), DB backup, upload, extraction, npm install, restart, and HTTP verification — in the correct safe order.
- The production database (`nexus.db`) must NEVER be overwritten, copied, or transferred. It lives only on the Jetson and is excluded from all tarballs.

## Local Server

- **NEVER start a local dev server.** Do not run `next dev`, `next start`, or any server locally for deployment purposes, however, you can run it for local development and testing then make sure you stop immediately after.
- The only production deployment target is the Jetson at `YOUR_SERVER_IP:3000`.

## Testing

- Always run `npx jest --forceExit` before deploying.
- After deployment, verify the Jetson responds with HTTP 200 and check `journalctl -u nexus-agent` for errors.


## Request End
- At the end of any request that changes files, make sure to update the following: Tests (unit tests and integration tests, and UI tests), Documentation (README, USAGE, INSTALLATION, ARCHITECTURE, TECH_SPECS), Scan for code vulnerabilities and apply fixes.
-Once that is done successfully, then you can proceed to deploy using the deployment instructions above, and make sure to verify the deployment was successful by checking the HTTP response and logs as described in the Testing section above.
-Then commit and push changes with proper commit messages and PR descriptions that reference the issue number and describe the changes made, the testing performed, and any other relevant information for reviewers and future reference.