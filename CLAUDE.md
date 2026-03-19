# Nexus Agent — Claude Code Instructions

> Migrated from `.github/copilot-instructions.md` and `.github/prompts/`.
> These rules apply to every task, no exceptions.

---

## Credential & Secret Safety (ABSOLUTE — No Exceptions)
- **NEVER read, display, print, log, or reference actual credential values** from `.env`, `production-backup/`, or any secret store. If a task requires checking that a secret exists, only confirm its presence — never show the value.
- **NEVER write actual secrets** (API keys, tokens, passwords, encryption keys, DB secrets, NEXTAUTH_SECRET values, endpoints that reveal resource names) into documentation, code comments, commit messages, PR descriptions, logs, or any tracked file.
- When documenting environment variables, use only placeholder values (e.g., `your-secret-here`, `<your-api-key>`, `***`).
- If you accidentally read a secret file, do NOT repeat the values in your response. Acknowledge the file exists and move on.
- The `production-backup/` directory contains live production secrets — treat it as read-forbidden unless explicitly asked to verify file existence only.
- **NEVER hardcode server IPs, hostnames, or usernames** in documentation, code, or scripts. Always use generic placeholders (`<host>`, `<user>`, `YOUR_SERVER_IP`).
- When running remote commands (SSH/SCP), never echo or log secrets. Use `--quiet` flags and redirect output away from secrets.

---

## Non-Negotiable Deployment Rules
- **NEVER deploy manually.** Always use `deploy.sh` via Git Bash: `bash deploy.sh <host> <user>`.
- Do **NOT** manually create tarballs, scp files, or run remote commands for production deploys.
- `deploy.sh` is the source of truth: version bump, tests, build, tarball (DB excluded), remote DB backup, upload/extract, dependency install, restart, and health verification.
- The production database `nexus.db` must **never** be overwritten, copied, or transferred from local.

---

## Local Runtime Constraints
- Do not run local servers for deployment purposes (`next dev`, `next start`).
- You may run local server only for development/testing, then stop it immediately.
- Production target is the configured deploy host (see `deploy.sh` arguments).

---

## Required Validation Flow
- Before deploy, run `npx jest --forceExit`.
- After deploy, verify HTTP 200 and inspect logs: `journalctl -u nexus-agent`.
- Run vulnerability scan/fix pass (`npm audit`, `npm audit fix`; use `--force` only with explicit approval because of breaking upgrades).

---

## Request-Start Issue Rule (Mandatory)
- Before starting implementation for any new user request, create a GitHub issue first.
- The issue must include:
  - Full problem/feature description
  - Clear acceptance criteria
  - Explicit test considerations (unit/integration/component scope and expected validation)
- Issue format is mandatory and must follow one of the repository templates:
  - **Feature Request template** for new features
  - **Bug Report template** for fixes/regressions
  - Both templates must include the same core structure:
    - `Feature Request` **or** `Bug Report`
    - `Use Case`
    - `Acceptance Criteria` (numbered checklist)
    - `Technical Notes`
    - `Test Considerations`
- Do not use free-form issue bodies when opening new work items.
- Do not begin code changes until the issue is created and referenced in the workflow.

---

## Request-End Checklist (Do Not Skip)
For any file change, complete **all** of the following in order:

1. **Implement** requested changes.
2. **Lint** — `npm run lint -- --max-warnings 0` must return 0 errors AND 0 warnings.
3. **Tests** — `npx jest --forceExit` full suite must pass.
4. **Vulnerability check** — `npm audit --audit-level=moderate`.
5. **Commit and push** to `main`. Commit/PR text must reference the issue number and clearly summarize changes + testing performed.
6. **Wait for CI quality gate** — check the GitHub Actions run triggered by the push; do NOT proceed until the run is green.
7. **Deploy** via `bash deploy.sh <host> <user>` **only after step 6 is green**.
8. **Verify** deployment health/logs/smoke checks (`journalctl -u nexus-agent`, HTTP 200).

Also update when relevant: tests (unit/integration/component), docs (`README`, `INSTALLATION`, `ARCHITECTURE`, `TECH_SPECS`), and vulnerability status.

### Evidence Policy
Final response must include concise evidence for each required step:
- command run
- pass/fail outcome

If a step is skipped or fails, explicitly state it and continue from that step.

---

## Self-Review Before Finalizing (Mandatory)
Before any final "done" response, run an internal self-review against all three review agents:

### Code Review Checklist
1. **Functional correctness** — Does code implement requested behavior exactly? Any broken logic, wrong conditions, state bugs, or edge-case failures?
2. **Regression risk** — Any behavior changes outside requested scope? API or UI contract breakage?
3. **Security and secrets** — Any secret exposure or unsafe handling?
4. **Performance and reliability** — New expensive loops, unnecessary renders, leaking timers/listeners, unstable async flows?
5. **Tests and docs** — Are tests updated to validate behavior? Are docs updated when behavior/architecture changed?

### Task Review Checklist
- Every explicit user requirement was implemented (none silently skipped).
- Required sequence was followed: issue → implement → tests → audit → deploy → health checks → commit/push.
- Each claimed step has concrete evidence (no summaries without command outcomes).

### Workflow Enforcer Checklist
- [ ] Issue created with correct template sections
- [ ] Implementation complete
- [ ] Full tests pass (`npx jest --forceExit`)
- [ ] `npm audit` clean
- [ ] Deployed via `deploy.sh`
- [ ] Health/log checks passed
- [ ] Committed and pushed

If any review would fail, continue working — do not finalize.

---

## Architecture Map (Start Here)
- Main agent loop: `src/lib/agent/loop.ts` (Sense → Think → Act, tool execution, knowledge retrieval, HITL).
- Worker offload path: `src/lib/agent/loop-worker.ts`, `src/lib/agent/worker-manager.ts`, `scripts/agent-worker.js`.
- Streaming chat API: `src/app/api/threads/[threadId]/chat/route.ts` (SSE `token/status/message/done/error`).
- Voice conversation endpoint: `src/app/api/conversation/respond/route.ts` (lightweight loop, tool support, no thread persistence).
- LLM provider/orchestration: `src/lib/llm/*` (provider selection, routing tier, OpenAI-compatible + Anthropic adapters).
- Persistence layer: `src/lib/db/queries.ts` + `src/lib/cache.ts` (write-through cache + invalidation on mutations).

---

## Project Conventions
- Use `@/` imports (see `jest.config.ts` and TS config alias behavior).
- Keep SSE writes guarded (`sseSend` + cancelled-stream checks) to avoid crashes on disconnect.
- Preserve per-user isolation checks on API routes (`requireUser` + ownership validation).
- Follow existing dispatch pattern for tools (built-ins + custom + MCP); avoid introducing parallel tool-routing logic.
- Prefer minimal, surgical edits; keep style and naming consistent with surrounding files.

---

## Test Strategy
- Full suite: `npx jest --forceExit`.
- Targeted: `npm run test:unit`, `npm run test:integration`, `npx jest --selectProjects component --forceExit`.
- Component tests run in `jsdom` with `tests/helpers/setup-jsdom.ts`; preserve existing mocks when updating UI.

---

## Mandatory Interaction Test Coverage (Non-Negotiable)

Every code change that touches a UI component MUST include or update **interaction-level tests** — not just render-or-heading tests.

### Rules

1. **New component = new test file.** Any new file in `src/components/` requires a corresponding test file in `tests/component/`. The test file MUST include at minimum:
   - One test confirming the component renders without throwing
   - One test for each user-interactive element (button, input, form) confirming it calls the expected callback with the expected arguments
   - One test for any conditional rendering (empty state, loading state, disabled state)

2. **Modified component = updated tests.** When editing an existing component file, check whether the modified code path is covered by interaction tests. If not, add tests before committing.

3. **Navigation stubs are NOT sufficient.** `full-navigation.test.tsx` replaces every component with stubs. Counting a component as "tested" because it appears as a stub is explicitly incorrect.

4. **What qualifies as an interaction test:**
   - `fireEvent.click(button)` → verify callback was called with correct args
   - `fireEvent.change(input, { target: { value: 'text' } })` → verify handler called
   - `fireEvent.keyDown(field, { key: 'Enter' })` → verify submit handler called
   - Asserting a button is `disabled` in a given state
   - Asserting conditional content appears/disappears based on props

5. **What does NOT count:**
   - `expect(screen.getByRole('heading')).toBeInTheDocument()` alone
   - `expect(component).not.toThrow()` alone
   - Any test where all child components are mocked as stubs before any assertion

6. **Approval/HITL flows must be tested.** Any component rendering approve/deny buttons MUST have tests for both paths.

7. **Form validation must be tested.** Required-field forms need tests for blocked-submit and valid-submit paths.
