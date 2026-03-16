# feat: Enforce architectural layer separation (tools, channels, batch jobs)

## Description

The codebase currently violates the core architectural separation rule: tools reference channels, tools export batch job logic, and bootstrap directly manages channel lifecycle instead of orchestrating batch jobs.

**Current violations:**
1. `src/lib/tools/email-tools.ts` imports from `src/lib/channels/email-channel.ts`
2. `src/lib/tools/email-tools.ts` defines `SchedulerBatchExecutionContext` and exports `runEmailReadBatch()` as a batch job function
3. `src/lib/tools/proactive-scan-tool.ts` exports `runProactiveScan()` as a batch job function  
4. `src/lib/bootstrap.ts` directly imports and starts Discord bots without orchestrating through batch jobs

This violates the rule: "**no tool should reference a communication channel, no tool should reference a batch job, no channel should reference a batch job, no batch job should reference a channel or mcp**"

## Use Case

- **Architecture clarity**: Clean separation enables independent testing, reuse, and evolution of each layer
- **Batch job orchestration**: Scheduler controls when/how polling and scans run; tools remain stateless
- **Channel abstraction**: Channels are transport only; startup logic doesn't bleed into bootstrap
- **Tool purity**: Tools are simple, reusable functions with no knowledge of batch execution context or channels

## Acceptance Criteria

1. Create `src/lib/batch-jobs/` directory with two new modules:
   - `email-polling-job.ts` - moves `pollEmailChannels` and `runEmailReadBatch` from tools
   - `proactive-scan-job.ts` - moves `runProactiveScan` from tools
2. Remove batch context type (`SchedulerBatchExecutionContext`) from tools layer; keep it in batch-jobs layer only
3. Update `src/lib/tools/email-tools.ts`:
   - Remove channel imports (`getEmailChannelConfig`, `isValidPort`, `sendSmtpMail`)
   - Keep only individual tool definitions (send, read, summarize)
   - Remove `pollEmailChannels()` and `runEmailReadBatch()` exports
4. Update `src/lib/tools/proactive-scan-tool.ts`:
   - Ensure no channel references
   - Remove batch context parameter from exported functions (move to batch job layer)
5. Update `src/lib/bootstrap.ts`:
   - Remove direct Discord bot startup logic
   - Defer channel initialization to batch jobs orchestration (via scheduler)
   - Keep only critical path (DB, scheduler) in bootstrap
6. Update imports across affected files (db queries, scheduler, notifications)
7. Add/update tests:
   - Unit tests for batch job logic (email-polling, proactive-scan)
   - Verify tools have no channel imports (via grep/type checking)
   - Integration tests for scheduler → batch job dispatch
8. Update `docs/ARCHITECTURE.md` to document the four-layer model:
   - **Batch Jobs**: Orchestrators (when/how to run)
   - **Tools**: Stateless actions (send, read, summarize, scan)
   - **Channels**: Transport only (Discord, email, WhatsApp, etc.)
   - **Bootstrap**: Initialize critical path, defer service startup to scheduler

## Technical Notes

- **Preserve existing behavior**: Email polling and proactive scanning must run exactly as before, just orchestrated differently
- **Batch context migration**: Move `SchedulerBatchExecutionContext`, `mergeBatchContext()`, batch-related logging helpers to batch-jobs layer
- **Helper functions**: Keep `sanitizeInboundEmailText()`, `truncateText()`, `buildGuardedInboundEmailPrompt()` in email-tools (they're tool utilities, not batch logic)
- **Service layer**: Email service (`src/lib/services/email-service-client.ts`) remains unchanged; batch jobs call services + tools as needed
- **Scheduler integration**: Unified scheduler engine already calls batch job functions; ensure imports/dispatch chain works correctly
- **No behavior change**: Polling frequency, scan logic, digest routing must remain identical

## Test Considerations

**Unit Tests**:
- `tests/unit/batch-jobs/email-polling-job.test.ts`: Poll logic, channel enumeration, unknown sender triage
- `tests/unit/batch-jobs/proactive-scan-job.test.ts`: Scan initialization, results aggregation
- Verify `src/lib/tools/email-tools.ts` has zero channel/batch-job imports (automated check or grep assertion)
- Verify `src/lib/tools/proactive-scan-tool.ts` has zero channel imports

**Integration Tests**:
- Scheduler → batch job dispatch via unified engine
- Email polling end-to-end (IMAP connect, fetch, triage, digest)
- Proactive scan end-to-end (registry enumeration, execution, reporting)

**Component Tests**:
- Bootstrap startup sequence (DB → scheduler ready before background services)

**Manual Verification**:
- Email polling and proactive scans run on their normal schedules
- Digest emails delivered correctly
- Logs show batch job context (schedule ID, run ID) correctly propagated

## Definition of Done

- [ ] New batch-jobs layer created with email-polling-job.ts and proactive-scan-job.ts
- [ ] Tools layer cleaned: zero channel/batch imports
- [ ] Bootstrap simplified: startup deferred to scheduler
- [ ] All imports updated across codebase
- [ ] Tests added/updated (unit, integration, manual smoke)
- [ ] Docs updated (ARCHITECTURE.md, TECH_SPECS.md)
- [ ] Lint passes (`npm run lint -- --max-warnings 0`)
- [ ] Full test suite passes (`npx jest --forceExit`)
- [ ] Audit clean (`npm audit --audit-level=moderate`)
- [ ] Commit/push to main
- [ ] CI pipeline green
- [ ] Deploy via `bash deploy.sh <host> <user>`
- [ ] Health checks pass (logs, HTTP 200, scheduler running)
