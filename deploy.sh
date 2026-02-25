#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  Nexus Agent — Safe Deployment Script
#  Usage: ./deploy.sh [host] [user]
#  
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

HOST="${1:?Usage: ./deploy.sh <host> <user>}"
USER="${2:?Usage: ./deploy.sh <host> <user>}"
REMOTE="${USER}@${HOST}"
REMOTE_DIR="~/AiAssistant"
TAR_NAME="deploy.tar"
DB_NAME="nexus.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "═══ Nexus Deploy ═══"
echo "Target: ${REMOTE}:${REMOTE_DIR}"
echo ""

# ── Step 1: Build locally ──────────────────────────────────────────
echo "[1/7] Running tests..."
npx jest --no-cache --silent 2>&1 | tail -3
echo ""

echo "[2/7] Building Next.js..."
npx next build 2>&1 | grep -E "✓|error|Error" | head -10
echo ""

# ── Step 2: Create deploy tarball (NEVER include DB files) ────────
echo "[3/7] Creating deploy tarball..."
tar -cf "${TAR_NAME}" \
  --exclude=".env" \
  --exclude="*.db" \
  --exclude="*.db-wal" \
  --exclude="*.db-shm" \
  --exclude="node_modules" \
  --exclude=".git" \
  --exclude=".next/cache" \
  --exclude="deploy.tar" \
  --exclude="data" \
  --exclude="deploy.sh" \
  .
echo "  Tarball: $(du -h ${TAR_NAME} | cut -f1)"
echo ""

# ── Step 3: Backup remote DB BEFORE touching anything ────────────
echo "[4/7] Backing up remote database..."
ssh "${REMOTE}" "
  cd ${REMOTE_DIR} 2>/dev/null || { echo 'Remote dir not found, fresh install'; exit 0; }
  if [ -f ${DB_NAME} ]; then
    BACKUP=${DB_NAME}.backup_${TIMESTAMP}
    # Checkpoint WAL into main DB file first
    node -e '
      try {
        const db = require(\"better-sqlite3\")(\"./nexus.db\");
        db.pragma(\"wal_checkpoint(TRUNCATE)\");
        db.close();
        console.log(\"  WAL checkpointed\");
      } catch(e) { console.log(\"  Checkpoint skipped:\", e.message); }
    ' 2>/dev/null || true
    cp ${DB_NAME} \${BACKUP}
    echo \"  Backup: \${BACKUP} ($(du -h ${DB_NAME} | cut -f1))\"
    # Keep only last 5 backups
    ls -t ${DB_NAME}.backup_* 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
  else
    echo '  No existing DB to backup'
  fi
"
echo ""

# ── Step 4: Stop the server gracefully ────────────────────────────
echo "[5/7] Stopping remote server..."
ssh "${REMOTE}" "
  cd ${REMOTE_DIR} 2>/dev/null || true
  PID=\$(lsof -ti:3000 2>/dev/null || true)
  if [ -n \"\${PID}\" ]; then
    kill \${PID} 2>/dev/null || true
    sleep 2
    # Force kill if still running
    kill -9 \${PID} 2>/dev/null || true
    echo '  Server stopped'
  else
    echo '  No server running'
  fi
"
echo ""

# ── Step 5: Upload and extract (DB files are EXCLUDED from tar) ──
echo "[6/7] Uploading and extracting..."
scp "${TAR_NAME}" "${REMOTE}:${REMOTE_DIR}/${TAR_NAME}"
ssh "${REMOTE}" "
  cd ${REMOTE_DIR}
  # Extract tar — this will NOT overwrite .db files (they're excluded)
  tar xf ${TAR_NAME}
  rm -f ${TAR_NAME}
  
  # Install deps if package.json changed
  npm install --production 2>&1 | tail -3
  echo '  Extracted and installed'
"
echo ""

# ── Step 6: Start server and verify ──────────────────────────────
echo "[7/7] Starting server and verifying..."
ssh "${REMOTE}" "
  cd ${REMOTE_DIR}
  nohup npm start > server.log 2>&1 &
  sleep 5
  
  # Verify HTTP 200
  HTTP_CODE=\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)
  if [ \"\${HTTP_CODE}\" = '200' ]; then
    echo \"  ✓ Server running (HTTP \${HTTP_CODE})\"
  else
    echo \"  ✗ Server check failed (HTTP \${HTTP_CODE})\"
    tail -10 server.log
    exit 1
  fi
  
  # Verify DB has data
  DATA_CHECK=\$(node -e '
    try {
      const db = require(\"better-sqlite3\")(\"./nexus.db\");
      const users = db.prepare(\"SELECT count(*) as c FROM users\").get().c;
      const tables = db.prepare(\"SELECT count(*) as c FROM sqlite_master WHERE type='table'\").get().c;
      console.log(\"tables=\" + tables + \" users=\" + users);
      db.close();
    } catch(e) { console.log(\"error: \" + e.message); }
  ' 2>/dev/null)
  echo \"  DB: \${DATA_CHECK}\"
"
echo ""
echo "═══ Deploy complete ═══"

# Cleanup local tarball
rm -f "${TAR_NAME}"
