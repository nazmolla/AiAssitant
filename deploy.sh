#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  Nexus Agent — Safe Deployment Script
#  Usage: ./deploy.sh [host] [user]
#
#  Designed for reliability on Windows (Git Bash / PowerShell).
#  Each remote operation is a discrete SSH call — no multi-line
#  heredocs, no fragile quoting chains.  SSH/SCP stderr warnings
#  (e.g. post-quantum key exchange) are silenced so PowerShell
#  does not misinterpret them as errors.
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

HOST="${1:?Usage: ./deploy.sh <host> <user>}"
USER="${2:?Usage: ./deploy.sh <host> <user>}"
REMOTE="${USER}@${HOST}"
REMOTE_DIR="~/AiAssistant"
TAR_NAME="deploy.tar.gz"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# ── Helpers ────────────────────────────────────────────────────────
# Wrapper that silences SSH stderr (post-quantum warnings) which
# cause PowerShell to report false exit-code failures.
rcmd() { ssh -o LogLevel=ERROR "${REMOTE}" "$@" 2>/dev/null; }
fail() { echo "  ✗ $1"; exit 1; }

echo "═══ Nexus Deploy ═══"
echo "Target: ${REMOTE}:${REMOTE_DIR}"
echo ""

# ── 1. Local: bump version & run tests ────────────────────────────
echo "[1/7] Bumping version & running tests..."
node scripts/bump-version.js
npx jest --no-cache --silent 2>&1 | tail -3
echo ""

echo "[2/7] Building Next.js..."
npx next build --webpack 2>&1 | grep -E "✓|error|Error" | head -10
echo ""

# ── 2. Local: create deploy tarball (NEVER include DB) ────────────
echo "[3/7] Creating deploy tarball..."
set +e
tar -czf "${TAR_NAME}" \
  --exclude=".env" \
  --exclude="*.db" \
  --exclude="*.db-wal" \
  --exclude="*.db-shm" \
  --exclude="node_modules" \
  --exclude=".git" \
  --exclude=".next/cache" \
  --exclude="${TAR_NAME}" \
  --exclude="data" \
  --exclude="deploy.sh" \
  .
TAR_EXIT=$?
set -e
# tar exit 1 = "file changed as we read it" — archive is valid; only fail on exit >= 2
if [ "$TAR_EXIT" -gt 1 ]; then fail "tar creation failed (exit $TAR_EXIT)"; fi
echo "  Tarball: $(du -h ${TAR_NAME} | cut -f1)"
echo ""

# ── 3. Remote: backup database ────────────────────────────────────
echo "[4/7] Backing up remote database..."
rcmd "cd ${REMOTE_DIR} && if [ -f nexus.db ]; then node -e 'try{require(\"better-sqlite3\")(\"./nexus.db\").pragma(\"wal_checkpoint(TRUNCATE)\");console.log(\"WAL checkpointed\")}catch(e){console.log(\"Checkpoint skipped\")}' 2>/dev/null; cp nexus.db nexus.db.backup_${TIMESTAMP}; ls -t nexus.db.backup_* 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null; echo '  DB backed up'; else echo '  No existing DB'; fi" \
  || echo "  (fresh install — no remote dir)"

# Capture pre-deploy DB metrics for post-deploy verification
PRE_DB_SIZE=$(rcmd "stat -c%s ${REMOTE_DIR}/nexus.db" || echo "0")
PRE_KNOWLEDGE=$(rcmd "cd ${REMOTE_DIR} && sqlite3 nexus.db 'SELECT COUNT(*) FROM user_knowledge'" || echo "0")
echo "  Snapshot: $(( PRE_DB_SIZE / 1048576 )) MB, ${PRE_KNOWLEDGE} knowledge entries"
echo ""

# ── 4. Remote: stop server ────────────────────────────────────────
echo "[5/7] Stopping remote server..."
rcmd "sudo systemctl stop nexus-agent 2>/dev/null || true"
sleep 2
rcmd "fuser -k 3000/tcp 2>/dev/null || true"
echo "  Server stopped"
echo ""

# ── 5. Remote: upload, extract, install ───────────────────────────
echo "[6/7] Uploading and extracting..."
scp -o LogLevel=ERROR "${TAR_NAME}" "${REMOTE}:/tmp/${TAR_NAME}" 2>/dev/null \
  || fail "scp upload failed"

# Remove stale build artifacts (keep DB + data)
rcmd "cd ${REMOTE_DIR} && rm -rf .next src/ public/"

# Verify DB survived cleanup
DB_CHECK=$(rcmd "stat -c%s ${REMOTE_DIR}/nexus.db" || echo "0")
if [ "${PRE_DB_SIZE}" -gt 1000000 ] && [ "${DB_CHECK}" != "${PRE_DB_SIZE}" ]; then
  fail "DB file changed during cleanup! (was ${PRE_DB_SIZE}, now ${DB_CHECK})"
fi

# Protect DB, extract, restore permissions
rcmd "cd ${REMOTE_DIR} && test -f nexus.db && chmod 444 nexus.db || true"
rcmd "cd ${REMOTE_DIR} && tar xzf /tmp/${TAR_NAME} --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' && rm -f /tmp/${TAR_NAME}" \
  || fail "tar extraction failed"
rcmd "cd ${REMOTE_DIR} && test -f nexus.db && chmod 664 nexus.db || true"

# Verify DB survived extraction
DB_CHECK=$(rcmd "stat -c%s ${REMOTE_DIR}/nexus.db" || echo "0")
if [ "${PRE_DB_SIZE}" -gt 1000000 ] && [ "${DB_CHECK}" != "${PRE_DB_SIZE}" ]; then
  echo "  ✗ DB modified during extraction! Restoring from backup..."
  rcmd "cd ${REMOTE_DIR} && cp nexus.db.backup_${TIMESTAMP} nexus.db && chmod 664 nexus.db"
  fail "DB was modified during extraction — restored from backup"
fi

# Install production dependencies
rcmd "cd ${REMOTE_DIR} && rm -rf node_modules && npm install --omit=dev --loglevel=error 2>&1 | tail -3" \
  || fail "npm install failed"
rcmd "cd ${REMOTE_DIR} && test -x node_modules/.bin/next" \
  || fail "next binary missing after install"
echo "  Extracted and installed"
echo ""

# ── 6. Remote: start & verify ─────────────────────────────────────
echo "[7/7] Starting server and verifying..."
rcmd "sudo systemctl restart nexus-agent"
sleep 8

HTTP_CODE=$(rcmd "curl -sk -o /dev/null -w '%{http_code}' https://localhost" || echo "000")
if [ "${HTTP_CODE}" = "200" ]; then
  echo "  ✓ Server running (HTTPS ${HTTP_CODE})"
else
  echo "  ✗ Health check failed (${HTTP_CODE})"
  rcmd "sudo journalctl -u nexus-agent --no-pager -n 15" || true
  fail "server did not start"
fi

NGINX_CODE=$(rcmd "curl -sk -o /dev/null -w '%{http_code}' https://${HOST}" || echo "000")
echo "  ✓ HTTPS proxy: ${NGINX_CODE}"

# DB integrity check: compare against pre-deploy snapshot
POST_DB_SIZE=$(rcmd "stat -c%s ${REMOTE_DIR}/nexus.db" || echo "0")
POST_KNOWLEDGE=$(rcmd "cd ${REMOTE_DIR} && sqlite3 nexus.db 'SELECT COUNT(*) FROM user_knowledge'" || echo "0")
echo "  DB: $(( POST_DB_SIZE / 1048576 )) MB, ${POST_KNOWLEDGE} knowledge entries"

if [ "${PRE_KNOWLEDGE}" -gt 100 ] && [ "${POST_KNOWLEDGE}" -lt "$((PRE_KNOWLEDGE / 2))" ]; then
  echo ""
  echo "  ✗ DATA LOSS DETECTED!"
  echo "    Before: ${PRE_KNOWLEDGE} knowledge ($(( PRE_DB_SIZE / 1048576 )) MB)"
  echo "    After:  ${POST_KNOWLEDGE} knowledge ($(( POST_DB_SIZE / 1048576 )) MB)"
  echo "    Auto-restoring from backup_${TIMESTAMP}..."
  rcmd "sudo systemctl stop nexus-agent"
  rcmd "cd ${REMOTE_DIR} && cp nexus.db.backup_${TIMESTAMP} nexus.db"
  rcmd "sudo systemctl start nexus-agent"
  sleep 8
  fail "Data loss detected — auto-restored from backup. Investigate before re-deploying."
fi
echo ""
echo "═══ Deploy complete ═══"

# Cleanup local tarball
rm -f "${TAR_NAME}"
