## Bug Report

**Use Case:** As the maintainer, I need `deploy.sh` to complete reliably so production can be updated after CI passes without manual intervention.

**Acceptance Criteria:**
1. Deployment does not fail at step 3 backup/checkpoint on healthy systems
2. If WAL checkpoint fails with transient disk I/O, deploy script handles fallback safely and continues when backup integrity is still guaranteed
3. Failure output clearly identifies actionable root cause (disk full, fs read-only, SQLite lock, etc.)
4. No production data loss risk introduced by the fix
5. Deployment health checks and smoke tests still run unchanged

**Technical Notes:**
- Current failure: `Checkpoint skipped: disk I/O error` at `[3/11] Backing up remote database`
- Existing checkpoint uses Node + better-sqlite3 one-liner; backup currently depends on this pre-step
- Must preserve DB safety guarantees and backup-first behavior in `deploy.sh`

**Test Considerations:**
- Validate deploy flow on existing prod host with same DB size profile
- Verify checkpoint fallback path using simulated checkpoint failure
- Verify backup creation + integrity check still pass
- Verify service health checks and smoke tests after deploy
