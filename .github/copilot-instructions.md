# Copilot Project Rules — Nexus Agent

## Credential & Secret Safety (ABSOLUTE — No Exceptions)
- **NEVER read, display, print, log, or reference actual credential values** from `.env`, `production-backup/`, or any secret store. If a task requires checking that a secret exists, only confirm its presence — never show the value.
- **NEVER write actual secrets** (API keys, tokens, passwords, encryption keys, DB secrets, NEXTAUTH_SECRET values, endpoints that reveal resource names) into documentation, code comments, commit messages, PR descriptions, logs, or any tracked file.
- When documenting environment variables, use only placeholder values (e.g., `your-secret-here`, `<your-api-key>`, `***`).
- If you accidentally read a secret file, do NOT repeat the values in your response. Acknowledge the file exists and move on.
- The `production-backup/` directory contains live production secrets — treat it as read-forbidden unless explicitly asked to verify file existence only.
- **NEVER hardcode server IPs, hostnames, or usernames** in documentation, code, or scripts. Always use generic placeholders (`<host>`, `<user>`, `YOUR_SERVER_IP`).
- When running remote commands (SSH/SCP), never echo or log secrets. Use `--quiet` flags and redirect output away from secrets.

## Non-Negotiable Deployment Rules
- **NEVER deploy manually.** Always use `deploy.sh` via Git Bash: `bash deploy.sh <host> <user>`.
- Do **NOT** manually create tarballs, scp files, or run remote commands for production deploys.
- `deploy.sh` is the source of truth: version bump, tests, build, tarball (DB excluded), remote DB backup, upload/extract, dependency install, restart, and health verification.
- The production database `nexus.db` must **never** be overwritten, copied, or transferred from local.

## Local Runtime Constraints
- Do not run local servers for deployment purposes (`next dev`, `next start`).
- You may run local server only for development/testing, then stop it immediately.
- Production target is the configured deploy host (see `deploy.sh` arguments).

## Required Validation Flow
- Before deploy, run `npx jest --forceExit`.
- After deploy, verify HTTP 200 and inspect logs: `journalctl -u nexus-agent`.
- Run vulnerability scan/fix pass (`npm audit`, `npm audit fix`; use `--force` only with explicit approval because of breaking upgrades).

## Request-End Checklist (Do Not Skip)
- For any file change, update: tests (unit/integration/component), docs (`README`, usage docs, `INSTALLATION`, `ARCHITECTURE`, `TECH_SPECS`), and vulnerability status.
- Then deploy via the required deployment flow above, verify service health/logs, and only then commit/push.
- Commit/PR text must reference the issue number and clearly summarize changes + testing performed.

## Architecture Map (Start Here)
- Main agent loop: `src/lib/agent/loop.ts` (Sense → Think → Act, tool execution, knowledge retrieval, HITL).
- Worker offload path: `src/lib/agent/loop-worker.ts`, `src/lib/agent/worker-manager.ts`, `scripts/agent-worker.js`.
- Streaming chat API: `src/app/api/threads/[threadId]/chat/route.ts` (SSE `token/status/message/done/error`).
- Voice conversation endpoint: `src/app/api/conversation/respond/route.ts` (lightweight loop, tool support, no thread persistence).
- LLM provider/orchestration: `src/lib/llm/*` (provider selection, routing tier, OpenAI-compatible + Anthropic adapters).
- Persistence layer: `src/lib/db/queries.ts` + `src/lib/cache.ts` (write-through cache + invalidation on mutations).

## Project Conventions
- Use `@/` imports (see `jest.config.ts` and TS config alias behavior).
- Keep SSE writes guarded (`sseSend` + cancelled-stream checks) to avoid crashes on disconnect.
- Preserve per-user isolation checks on API routes (`requireUser` + ownership validation).
- Follow existing dispatch pattern for tools (built-ins + custom + MCP); avoid introducing parallel tool-routing logic.
- Prefer minimal, surgical edits; keep style and naming consistent with surrounding files.

## Test Strategy in This Repo
- Full suite: `npx jest --forceExit`.
- Targeted: `npm run test:unit`, `npm run test:integration`, `npx jest --selectProjects component --forceExit`.
- Component tests run in `jsdom` with `tests/helpers/setup-jsdom.ts`; preserve existing mocks when updating UI.

## Copilot Workflow Enforcement (Mandatory)
- Before any final "done" response, run an internal self-review using:
	- `.github/prompts/task-review.prompt.md`
	- `.github/prompts/code-review.prompt.md`
	- `.github/prompts/workflow-enforcer.prompt.md`
- If any review would fail, continue working and do not finalize.
- Never claim completion without evidence for required workflow steps.

### Required Completion Sequence
1. Implement requested changes.
2. Run tests (full suite unless user explicitly requests otherwise).
3. Run vulnerability check (`npm audit`).
4. Deploy via `bash deploy.sh <host> <user>`.
5. Verify deployment health/logs/smoke checks.
6. Commit and push.

### Evidence Policy
- Final response must include concise evidence for each required step:
	- command run
	- pass/fail outcome
- If a step is skipped or fails, explicitly state it and continue from that step.