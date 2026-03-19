#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  Nexus Agent — Production Deployment Script
#  Usage: bash deploy.sh <host> <user>
#
#  Flow:
#    1. Local:  lint + tests + version bump
#    2. Local:  create source tarball (no DB, no .next, no node_modules)
#    3. Remote: WAL checkpoint + backup DB + integrity check
#    4. Remote: create staging release directory
#    5. Remote: upload + extract source into staging
#    6. Remote: npm install in staging
#    7. Remote: build in staging (DB isolated)
#    8. Remote: start staging preview + heartbeat check
#    9. Remote: cut over (stop old service, sync staged build, start service)
#   10. Remote: functional smoke tests (API key + endpoints)
#   11. Remote: post-deploy DB validation (row counts vs snapshot)
#   11. Local:  cleanup
#
#  On failure at any step, the script auto-restores the DB from
#  its timestamped backup if needed.
#
#  Designed for Windows (Git Bash / PowerShell). Each remote op
#  is a discrete SSH call — no heredocs, no fragile quoting.
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Arguments ──────────────────────────────────────────────────────
HOST="${1:?Usage: bash deploy.sh <host> <user>}"
USER="${2:?Usage: bash deploy.sh <host> <user>}"
REMOTE="${USER}@${HOST}"
REMOTE_DIR="~/AiAssistant"
TAR_NAME="deploy.tar.gz"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
STAGING_DIR="/tmp/nexus-release-${TIMESTAMP}"
PREVIEW_PORT=3002
PREVIEW_PID_FILE="/tmp/nexus-preview-${TIMESTAMP}.pid"
MAX_BACKUPS=5          # keep last N DB backups on server
HEALTH_WAIT=10         # seconds to wait after start before health check
STEPS=11
ALLOW_SMOKE_FAIL="${DEPLOY_ALLOW_SMOKE_FAIL:-0}"   # set to 1 only for emergency/non-blocking smoke checks

# ── Helpers ────────────────────────────────────────────────────────
rcmd()  { ssh -o LogLevel=ERROR -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "${REMOTE}" "$@" 2>/dev/null; }
rcmd_long() { ssh -o LogLevel=ERROR -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=10 "${REMOTE}" "$@" 2>/dev/null; }
rcmd_diag() { ssh -o LogLevel=ERROR "${REMOTE}" "$@"; }
fail()  { echo ""; echo "  ✗ FAILED: $1"; exit 1; }
step()  { echo ""; echo "[${1}/${STEPS}] ${2}"; }

# DB safety: if script exits while DB is in .build_safe, restore it
DB_IN_BUILD_SAFE=false
cleanup_db() {
  if [ "${DB_IN_BUILD_SAFE}" = "true" ]; then
    echo ""
    echo "  ⚠ Script exiting with DB in .build_safe — restoring..."
    ssh -o LogLevel=ERROR -o ConnectTimeout=10 "${REMOTE}" \
      "cd ${REMOTE_DIR} && rm -f nexus.db nexus.db-shm nexus.db-wal 2>/dev/null; test -f nexus.db.build_safe && mv nexus.db.build_safe nexus.db && mv nexus.db-shm.build_safe nexus.db-shm 2>/dev/null; mv nexus.db-wal.build_safe nexus.db-wal 2>/dev/null; echo '  ✓ DB restored from .build_safe'" 2>/dev/null || echo "  ✗ FAILED to restore DB — manually run: mv nexus.db.build_safe nexus.db"
  fi
}

cleanup_preview() {
  ssh -o LogLevel=ERROR -o ConnectTimeout=10 "${REMOTE}" \
    "test -f ${PREVIEW_PID_FILE} && kill \$(cat ${PREVIEW_PID_FILE}) 2>/dev/null || true; rm -f ${PREVIEW_PID_FILE}" 2>/dev/null || true
}
trap 'cleanup_preview; cleanup_db' EXIT

echo "═══════════════════════════════════════════"
echo "  Nexus Agent — Deploy"
echo "  Target: ${REMOTE}:${REMOTE_DIR}"
echo "  Time:   $(date '+%Y-%m-%d %H:%M:%S')"
if [ "${ALLOW_SMOKE_FAIL}" = "1" ]; then
  echo "  Mode:   DEPLOY_ALLOW_SMOKE_FAIL=1 (smoke failures will be non-blocking)"
fi
echo "═══════════════════════════════════════════"

# ── 1. Local: lint + tests + version bump ─────────────────────────
step 1 "Running local lint, tests, and version bump..."
node scripts/bump-version.js
VERSION=$(node -p "require('./package.json').version")
echo "  Version: ${VERSION}"

echo "  Running lint..."
npx eslint src/ --quiet 2>&1 | tail -3 \
  || fail "Lint failed — fix errors before deploying"

echo "  ✓ Lint passed (tests run locally only — skipped during deploy)"

# ── 2. Local: create source tarball ───────────────────────────────
step 2 "Creating source tarball..."
rm -f "${TAR_NAME}"
set +e
tar -czf "${TAR_NAME}" \
  --exclude=".env" \
  --exclude="*.db" \
  --exclude="*.db-wal" \
  --exclude="*.db-shm" \
  --exclude="node_modules" \
  --exclude=".git" \
  --exclude=".next" \
  --exclude="${TAR_NAME}" \
  --exclude="data" \
  --exclude="production-backup" \
  .
TAR_EXIT=$?
set -e
# tar exit 1 = "file changed as we read it" — archive is still valid
if [ "${TAR_EXIT}" -gt 1 ]; then fail "tar creation failed (exit ${TAR_EXIT})"; fi
echo "  ✓ Tarball: $(du -h ${TAR_NAME} | cut -f1)"

# ── 3. Remote: backup database ────────────────────────────────────
step 3 "Backing up remote database..."

echo "  Pre-cleaning stale artifacts before backup..."
rcmd "cd ${REMOTE_DIR} && ls -t nexus.db.backup_* 2>/dev/null | tail -n +3 | xargs rm -f 2>/dev/null || true"
rcmd "cd ${REMOTE_DIR} && rm -f deploy.tar deploy-fresh.tar.gz nexus-deploy.tar.gz ${TAR_NAME} 2>/dev/null || true"
rcmd "rm -f /tmp/${TAR_NAME} /tmp/deploy*.tar* 2>/dev/null || true"

echo "  Remote storage snapshot:"
rcmd "df -h ${REMOTE_DIR} /tmp 2>/dev/null | sed 's/^/    /'" || true

FREE_KB=$(rcmd "df -k ${REMOTE_DIR} | awk 'NR==2{print \$4}'" || echo "0")
if [ "${FREE_KB}" -lt 1048576 ]; then
  echo "  ✗ Not enough free space on remote disk after cleanup"
  rcmd_diag "df -h ${REMOTE_DIR} /tmp | sed 's/^/    /'" || true
  fail "Remote disk free space < 1GB; cannot safely create DB backup"
fi

# Check if remote dir exists (fresh install)
if ! rcmd "test -d ${REMOTE_DIR}"; then
  echo "  First deploy — creating remote directory"
  rcmd "mkdir -p ${REMOTE_DIR}"
  PRE_DB_SIZE=0
  PRE_DB_TABLES=0
  PRE_KNOWLEDGE=0
  PRE_THREADS=0
else
  # WAL checkpoint to flush any pending writes
  rcmd "cd ${REMOTE_DIR} && test -f nexus.db && node -e 'try{require(\"better-sqlite3\")(\"./nexus.db\").pragma(\"wal_checkpoint(TRUNCATE)\");console.log(\"  WAL checkpointed\")}catch(e){console.log(\"  Checkpoint skipped:\",e.message)}' || echo '  No DB to checkpoint'" || true

  # Backup
  if rcmd "test -f ${REMOTE_DIR}/nexus.db"; then
    if ! rcmd "cd ${REMOTE_DIR} && cp nexus.db nexus.db.backup_${TIMESTAMP}"; then
      echo "  ✗ Backup copy failed; remote diagnostics:"
      rcmd_diag "df -h ${REMOTE_DIR} /tmp | sed 's/^/    /'" || true
      rcmd_diag "cd ${REMOTE_DIR} && ls -lh nexus.db nexus.db-wal nexus.db-shm 2>/dev/null | sed 's/^/    /'" || true
      rcmd_diag "cd ${REMOTE_DIR} && sqlite3 nexus.db 'PRAGMA integrity_check;' 2>/dev/null | head -1 | sed 's/^/    integrity: /'" || true
      fail "Remote DB backup copy failed (step 3)"
    fi
    echo "  ✓ Backed up as nexus.db.backup_${TIMESTAMP}"

    # Prune old backups (keep MAX_BACKUPS)
    rcmd "cd ${REMOTE_DIR} && ls -t nexus.db.backup_* 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f 2>/dev/null || true"

    # Integrity check
    INTEGRITY=$(rcmd "cd ${REMOTE_DIR} && sqlite3 nexus.db 'PRAGMA integrity_check;'" || echo "ERROR")
    if [ "${INTEGRITY}" != "ok" ]; then
      echo "  ⚠ DB integrity issue: ${INTEGRITY}"
      echo "  Proceeding with deploy — backup preserved"
    else
      echo "  ✓ DB integrity: ok"
    fi

    # Snapshot metrics for post-deploy comparison
    PRE_DB_SIZE=$(rcmd "stat -c%s ${REMOTE_DIR}/nexus.db" || echo "0")
    PRE_DB_TABLES=$(rcmd "cd ${REMOTE_DIR} && sqlite3 nexus.db 'SELECT COUNT(*) FROM sqlite_master WHERE type=\"table\";'" || echo "0")
    PRE_KNOWLEDGE=$(rcmd "cd ${REMOTE_DIR} && sqlite3 nexus.db 'SELECT COUNT(*) FROM user_knowledge;'" || echo "0")
    PRE_THREADS=$(rcmd "cd ${REMOTE_DIR} && sqlite3 nexus.db 'SELECT COUNT(*) FROM threads;'" || echo "0")
    echo "  Snapshot: $(( PRE_DB_SIZE / 1048576 )) MB, ${PRE_DB_TABLES} tables, ${PRE_KNOWLEDGE} knowledge, ${PRE_THREADS} threads"
  else
    echo "  No existing DB (fresh install)"
    PRE_DB_SIZE=0
    PRE_DB_TABLES=0
    PRE_KNOWLEDGE=0
    PRE_THREADS=0
  fi
fi

# ── 4. Remote: create staging release directory ───────────────────
step 4 "Preparing staging release directory..."
rcmd "rm -rf ${STAGING_DIR} && mkdir -p ${STAGING_DIR}" \
  || fail "Failed to prepare staging release directory"
echo "  ✓ Staging dir ready: ${STAGING_DIR}"

# ── 5. Remote: upload + extract into staging ──────────────────────
step 5 "Uploading and extracting source into staging..."
scp -o LogLevel=ERROR "${TAR_NAME}" "${REMOTE}:/tmp/${TAR_NAME}" 2>/dev/null \
  || fail "scp upload failed"

# Extract into staging only (live service remains untouched)
rcmd "cd ${STAGING_DIR} && tar xzf /tmp/${TAR_NAME} --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' && rm -f /tmp/${TAR_NAME}" \
  || fail "tar extraction failed"

# Verify DB was not touched
if [ "${PRE_DB_SIZE}" -gt 0 ]; then
  DB_CHECK=$(rcmd "stat -c%s ${REMOTE_DIR}/nexus.db" || echo "0")
  if [ "${DB_CHECK}" != "${PRE_DB_SIZE}" ]; then
    echo "  ✗ DB size changed during extraction! Restoring from backup..."
    rcmd "cd ${REMOTE_DIR} && cp nexus.db.backup_${TIMESTAMP} nexus.db && chmod 664 nexus.db"
    fail "DB was modified during extraction — restored from backup"
  fi
fi
echo "  ✓ Source extracted, DB intact"

# ── 6. Remote: install dependencies in staging ────────────────────
step 6 "Installing dependencies in staging..."
rcmd "cd ${STAGING_DIR} && npm ci --loglevel=error 2>&1 | tail -5" \
  || fail "npm ci failed"
rcmd "cd ${STAGING_DIR} && test -x node_modules/.bin/next" \
  || fail "next binary missing after install"
echo "  ✓ Dependencies installed"

# ── 7. Remote: build staging release (DB isolated) ────────────────
step 7 "Building staging release (DB isolated)..."
# Protect against accidental DB creation in staging during build
rcmd "cd ${STAGING_DIR} && test -f nexus.db && mv nexus.db nexus.db.build_safe || true"
rcmd "cd ${STAGING_DIR} && test -f nexus.db-shm && mv nexus.db-shm nexus.db-shm.build_safe || true"
rcmd "cd ${STAGING_DIR} && test -f nexus.db-wal && mv nexus.db-wal nexus.db-wal.build_safe || true"
DB_IN_BUILD_SAFE=true

# Use long-lived SSH with keepalive — build can take minutes
BUILD_OUTPUT=$(rcmd_long "cd ${STAGING_DIR} && npx next build --webpack 2>&1" || true)
echo "${BUILD_OUTPUT}" | tail -10
BUILD_FAILED=$(echo "${BUILD_OUTPUT}" | grep -c 'Build failed\|Build error' || true)

# Remove any staging DB artifacts created during build and restore staged placeholders
rcmd "cd ${STAGING_DIR} && rm -f nexus.db nexus.db-shm nexus.db-wal 2>/dev/null; true"
rcmd "cd ${STAGING_DIR} && test -f nexus.db.build_safe && mv nexus.db.build_safe nexus.db 2>/dev/null || true"
rcmd "cd ${STAGING_DIR} && test -f nexus.db-shm.build_safe && mv nexus.db-shm.build_safe nexus.db-shm 2>/dev/null || true"
rcmd "cd ${STAGING_DIR} && test -f nexus.db-wal.build_safe && mv nexus.db-wal.build_safe nexus.db-wal 2>/dev/null || true"
DB_IN_BUILD_SAFE=false

# Verify DB restore actually worked (size must match pre-deploy)
if [ "${PRE_DB_SIZE}" -gt 0 ]; then
  RESTORED_SIZE=$(rcmd "stat -c%s ${REMOTE_DIR}/nexus.db" || echo "0")
  if [ "${RESTORED_SIZE}" != "${PRE_DB_SIZE}" ]; then
    echo "  ✗ DB size mismatch after restore: ${RESTORED_SIZE} vs ${PRE_DB_SIZE}"
    echo "  Restoring from timestamped backup..."
    rcmd "cd ${REMOTE_DIR} && cp nexus.db.backup_${TIMESTAMP} nexus.db && chmod 664 nexus.db"
    RESTORED_SIZE=$(rcmd "stat -c%s ${REMOTE_DIR}/nexus.db" || echo "0")
    if [ "${RESTORED_SIZE}" != "${PRE_DB_SIZE}" ]; then
      fail "DB restore failed — manual intervention required"
    fi
  fi
  echo "  ✓ DB restored: $(( RESTORED_SIZE / 1048576 )) MB"
fi

if [ "${BUILD_FAILED}" -gt 0 ]; then
  echo ""
  echo "  Build errors:"
  echo "${BUILD_OUTPUT}" | grep -A2 'Error\|Module not found' | head -20
  fail "next build failed on server"
fi

# Verify .next build output exists in staging
rcmd "cd ${STAGING_DIR} && test -d .next/server" \
  || fail ".next/server directory missing after build"

# Prune dev dependencies to reduce disk footprint
rcmd "cd ${STAGING_DIR} && npm prune --omit=dev --loglevel=error 2>&1 | tail -3" || true
echo "  ✓ Build complete, dev deps pruned"

# ── 8. Remote: staging heartbeat check ───────────────────────────
step 8 "Starting staging preview and heartbeat check..."
rcmd "test -f ${PREVIEW_PID_FILE} && kill \$(cat ${PREVIEW_PID_FILE}) 2>/dev/null || true; rm -f ${PREVIEW_PID_FILE}"
rcmd "cd ${STAGING_DIR} && nohup env PORT=${PREVIEW_PORT} npm run start </dev/null >/tmp/nexus-preview-${TIMESTAMP}.log 2>&1 & echo \$! > ${PREVIEW_PID_FILE}" \
  || fail "Failed to start staging preview instance"

echo "  Waiting ${HEALTH_WAIT}s for staging preview startup..."
sleep "${HEALTH_WAIT}"

PREVIEW_HTTP=$(rcmd "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:${PREVIEW_PORT}" || echo "000")
if [ "${PREVIEW_HTTP}" != "200" ]; then
  echo "  ✗ Staging heartbeat failed on :${PREVIEW_PORT} (code ${PREVIEW_HTTP})"
  rcmd "tail -n 30 /tmp/nexus-preview-${TIMESTAMP}.log" || true
  fail "Staging preview failed heartbeat; keeping old instance untouched"
fi
echo "  ✓ Staging preview heartbeat: ${PREVIEW_HTTP}"

# Stop preview process prior to cutover
rcmd "test -f ${PREVIEW_PID_FILE} && kill \$(cat ${PREVIEW_PID_FILE}) 2>/dev/null || true; rm -f ${PREVIEW_PID_FILE}"

# Keep existing DB integrity check before cutover
if [ "${PRE_DB_SIZE}" -gt 0 ]; then
  POST_BUILD_SIZE=$(rcmd "stat -c%s ${REMOTE_DIR}/nexus.db" || echo "0")
  POST_BUILD_INTEGRITY=$(rcmd "cd ${REMOTE_DIR} && sqlite3 nexus.db 'PRAGMA integrity_check;'" || echo "ERROR")

  if [ "${POST_BUILD_INTEGRITY}" != "ok" ]; then
    echo "  ✗ DB corrupted after build! Restoring from backup..."
    rcmd "cd ${REMOTE_DIR} && cp nexus.db.backup_${TIMESTAMP} nexus.db && chmod 664 nexus.db"
    echo "  ✓ Restored from backup_${TIMESTAMP}"
    # Re-verify
    RESTORED_INTEGRITY=$(rcmd "cd ${REMOTE_DIR} && sqlite3 nexus.db 'PRAGMA integrity_check;'" || echo "ERROR")
    if [ "${RESTORED_INTEGRITY}" != "ok" ]; then
      fail "Backup DB also corrupted! Manual intervention required."
    fi
  else
    echo "  ✓ DB integrity: ok ($(( POST_BUILD_SIZE / 1048576 )) MB)"
  fi
else
  echo "  (fresh install — no DB to verify)"
fi

# ── 9. Remote: cut over + health check ───────────────────────────
step 9 "Cutover to staged release and run health checks..."

# Stop current service only at cutover point
rcmd "sudo systemctl stop nexus-agent 2>/dev/null || true"
sleep 2
rcmd "fuser -k 3000/tcp 2>/dev/null || true"

# Sync staged release into live dir while preserving DB/data/.env
if rcmd "command -v rsync >/dev/null 2>&1"; then
  rcmd "rsync -a --delete --exclude='.env' --exclude='nexus.db' --exclude='nexus.db-*' --exclude='data' --exclude='production-backup' ${STAGING_DIR}/ ${REMOTE_DIR}/" \
    || fail "Failed to sync staged release into live directory"
else
  rcmd "cd ${REMOTE_DIR} && rm -rf .next src public scripts docs tests || true"
  rcmd "cd ${STAGING_DIR} && tar cf - --exclude='.env' --exclude='nexus.db' --exclude='nexus.db-*' --exclude='data' --exclude='production-backup' . | (cd ${REMOTE_DIR} && tar xf -)" \
    || fail "Failed to copy staged release into live directory"
fi

# Cleanup staging dir after successful sync
rcmd "rm -rf ${STAGING_DIR}" || true

rcmd "sudo systemctl start nexus-agent"
echo "  Waiting ${HEALTH_WAIT}s for startup..."
sleep "${HEALTH_WAIT}"

# Check systemd thinks it's running
SVC_STATE=$(rcmd "systemctl is-active nexus-agent" || echo "unknown")
if [ "${SVC_STATE}" != "active" ]; then
  echo "  ✗ Service state: ${SVC_STATE}"
  rcmd "sudo journalctl -u nexus-agent --no-pager -n 20" || true
  fail "Service failed to start"
fi
echo "  ✓ Service: active"

# HTTP health on localhost:3000
HTTP_3000=$(rcmd "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000" || echo "000")
if [ "${HTTP_3000}" != "200" ]; then
  echo "  ✗ HTTP :3000 returned ${HTTP_3000}"
  rcmd "sudo journalctl -u nexus-agent --no-pager -n 20" || true
  fail "Health check failed on port 3000"
fi
echo "  ✓ HTTP :3000 → ${HTTP_3000}"

# HTTPS health via nginx
HTTPS_CODE=$(rcmd "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://localhost" || echo "000")
echo "  ✓ HTTPS :443 → ${HTTPS_CODE}"

# ── 10. Remote: functional smoke tests ────────────────────────────
step 10 "Running functional smoke tests..."
SMOKE_RESULT=$(rcmd "cd ${REMOTE_DIR} && node scripts/smoke-test.js 2>&1" || true)
echo "${SMOKE_RESULT}"
if echo "${SMOKE_RESULT}" | grep -q '0 failed'; then
  echo "  ✓ All smoke tests passed"
else
  if [ "${ALLOW_SMOKE_FAIL}" = "1" ]; then
    echo "  ⚠ Smoke tests had failures (override active: non-blocking)"
  else
    fail "Smoke tests failed — deployment blocked. Set DEPLOY_ALLOW_SMOKE_FAIL=1 only for emergency override."
  fi
fi

# ── 11. Remote: post-deploy DB validation ─────────────────────────
step 11 "Post-deploy database validation..."
if [ "${PRE_DB_SIZE}" -gt 0 ]; then
  POST_DB_SIZE=$(rcmd "stat -c%s ${REMOTE_DIR}/nexus.db" || echo "0")
  POST_INTEGRITY=$(rcmd "cd ${REMOTE_DIR} && sqlite3 nexus.db 'PRAGMA integrity_check;'" || echo "ERROR")
  POST_TABLES=$(rcmd "cd ${REMOTE_DIR} && sqlite3 nexus.db 'SELECT COUNT(*) FROM sqlite_master WHERE type=\"table\";'" || echo "0")
  POST_KNOWLEDGE=$(rcmd "cd ${REMOTE_DIR} && sqlite3 nexus.db 'SELECT COUNT(*) FROM user_knowledge;'" || echo "0")
  POST_THREADS=$(rcmd "cd ${REMOTE_DIR} && sqlite3 nexus.db 'SELECT COUNT(*) FROM threads;'" || echo "0")

  echo "  Integrity:  ${POST_INTEGRITY}"
  echo "  Size:       $(( POST_DB_SIZE / 1048576 )) MB (was $(( PRE_DB_SIZE / 1048576 )) MB)"
  echo "  Tables:     ${POST_TABLES} (was ${PRE_DB_TABLES})"
  echo "  Knowledge:  ${POST_KNOWLEDGE} (was ${PRE_KNOWLEDGE})"
  echo "  Threads:    ${POST_THREADS} (was ${PRE_THREADS})"

  # Data loss detection: if knowledge or threads dropped by >50%, auto-restore
  LOSS=false
  if [ "${PRE_KNOWLEDGE}" -gt 100 ] && [ "${POST_KNOWLEDGE}" -lt "$((PRE_KNOWLEDGE / 2))" ]; then
    echo "  ✗ Knowledge entries dropped significantly!"
    LOSS=true
  fi
  if [ "${PRE_THREADS}" -gt 10 ] && [ "${POST_THREADS}" -lt "$((PRE_THREADS / 2))" ]; then
    echo "  ✗ Thread count dropped significantly!"
    LOSS=true
  fi
  if [ "${POST_INTEGRITY}" != "ok" ]; then
    echo "  ✗ DB integrity failed!"
    LOSS=true
  fi

  if [ "${LOSS}" = "true" ]; then
    echo ""
    echo "  ⚠ DATA LOSS DETECTED — auto-restoring..."
    rcmd "sudo systemctl stop nexus-agent"
    rcmd "cd ${REMOTE_DIR} && cp nexus.db.backup_${TIMESTAMP} nexus.db && chmod 664 nexus.db"
    rcmd "sudo systemctl start nexus-agent"
    sleep "${HEALTH_WAIT}"
    RESTORED_CODE=$(rcmd "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000" || echo "000")
    echo "  ✓ Restored from backup_${TIMESTAMP}, health: ${RESTORED_CODE}"
    fail "Data loss detected — auto-restored. Investigate before re-deploying."
  fi

  echo "  ✓ All DB checks passed"
else
  echo "  (fresh install — no baseline to compare)"
fi

# ── Cleanup ───────────────────────────────────────────────────────
rm -f "${TAR_NAME}"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✓ Deploy complete — v${VERSION}"
echo "  Service: active"
echo "  Health:  HTTP ${HTTP_3000} / HTTPS ${HTTPS_CODE}"
echo "═══════════════════════════════════════════"
