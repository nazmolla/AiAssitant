# Copilot Project Rules — Nexus Agent

## Non-Negotiable Deployment Rules
- **NEVER deploy manually.** Always use `deploy.sh` via Git Bash: `bash deploy.sh YOUR_SERVER_IP jetson`.
- Do **NOT** manually create tarballs, scp files, or run remote commands for production deploys.
- `deploy.sh` is the source of truth: version bump, tests, build, tarball (DB excluded), remote DB backup, upload/extract, dependency install, restart, and health verification.
- The production database `nexus.db` must **never** be overwritten, copied, or transferred from local.

## Local Runtime Constraints
- Do not run local servers for deployment purposes (`next dev`, `next start`).
- You may run local server only for development/testing, then stop it immediately.
- Production target is only Jetson at `YOUR_SERVER_IP:3000`.

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