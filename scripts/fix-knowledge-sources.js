#!/usr/bin/env node
/**
 * Migration script: Fix misclassified knowledge sources.
 *
 * Threads titled "[proactive-scan]" or "[scheduled] ..." generated knowledge
 * tagged as "chat:<threadId>" instead of "proactive:<threadId>".
 *
 * This script:
 *  1. Finds all proactive/scheduled thread IDs.
 *  2. Rewrites matching source_context prefixes from [chat:<id>] → [proactive:<id>].
 *
 * Usage:  node scripts/fix-knowledge-sources.js [--dry-run]
 */

const Database = require("better-sqlite3");
const path = require("path");

const DRY = process.argv.includes("--dry-run");
const dbPath = process.argv.find((a) => a.endsWith(".db")) || path.resolve(__dirname, "..", "nexus.db");

console.log(`Database: ${dbPath}`);
console.log(`Mode: ${DRY ? "DRY RUN" : "LIVE"}\n`);

const db = new Database(dbPath);

// 1. Find all proactive / scheduled thread IDs
const proactiveThreads = db
  .prepare(
    `SELECT id, title FROM threads
     WHERE title LIKE '[proactive-scan]%' OR title LIKE '[scheduled]%'`
  )
  .all();

console.log(`Found ${proactiveThreads.length} proactive/scheduled thread(s).`);

if (proactiveThreads.length === 0) {
  console.log("Nothing to fix.");
  process.exit(0);
}

// 2. For each thread, update matching knowledge entries
const update = db.prepare(
  `UPDATE user_knowledge
   SET source_context = '[proactive:' || ? || ']' || SUBSTR(source_context, LENGTH('[chat:' || ? || ']') + 1)
   WHERE source_context LIKE '[chat:' || ? || ']%'`
);

let totalUpdated = 0;

const runAll = db.transaction(() => {
  for (const t of proactiveThreads) {
    const info = DRY
      ? { changes: db.prepare(`SELECT COUNT(*) AS c FROM user_knowledge WHERE source_context LIKE '[chat:' || ? || ']%'`).get(t.id).c }
      : update.run(t.id, t.id, t.id);

    const count = DRY ? info.changes : info.changes;
    if (count > 0) {
      console.log(`  Thread ${t.id} (${t.title}): ${count} entries ${DRY ? "would be" : ""} updated`);
    }
    totalUpdated += count;
  }
});

runAll();

console.log(`\nTotal: ${totalUpdated} knowledge entries ${DRY ? "would be" : ""} updated.`);
db.close();
