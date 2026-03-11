#!/usr/bin/env ts-node
/**
 * One-time cleanup script for legacy migrated system run-once schedules
 * 
 * Deletes old scheduler_schedules records with:
 *   - trigger_type = 'once'
 *   - AND either owner_type = 'system' OR schedule_key prefixed with legacy.scheduled_task
 * 
 * These are leftover from the migration to the unified scheduler engine.
 * Safe to run multiple times (idempotent) as it checks app_config marker.
 * 
 * Usage (local): npx ts-node scripts/cleanup-legacy-system-once-schedules.ts
 * Usage (remote): ssh user@host 'cd /app && npx ts-node scripts/cleanup-legacy-system-once-schedules.ts'
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'nexus.db');
const APP_CONFIG_KEY = 'scheduler.cleanup_legacy_system_once_v1';

async function main() {
  console.log('Starting cleanup of legacy system run-once schedules...');
  console.log(`Database: ${DB_PATH}\n`);

  let db: Database.Database | null = null;

  try {
    db = new Database(DB_PATH);

    // Check if cleanup has already been run
    const checkConfig = db.prepare(`
      SELECT value FROM app_config WHERE key = ?
    `);
    const result = checkConfig.get(APP_CONFIG_KEY) as { value: string } | undefined;

    if (result) {
      console.log(`✓ Cleanup already completed on: ${result.value}`);
      console.log('  Skipping (idempotent).\n');
      return;
    }

    // Count legacy records before cleanup
    const countBefore = db.prepare(`
      SELECT COUNT(*) as count FROM scheduler_schedules
      WHERE trigger_type = 'once'
        AND (
          owner_type = 'system'
          OR schedule_key LIKE 'legacy.scheduled_task%'
        )
    `);
    const before = countBefore.get() as { count: number };
    console.log(`Legacy records found: ${before.count}`);

    if (before.count === 0) {
      console.log('No legacy records to clean up.');
    } else {
      // Delete legacy records
      const deleteStmt = db.prepare(`
        DELETE FROM scheduler_schedules
        WHERE trigger_type = 'once'
          AND (
            owner_type = 'system'
            OR schedule_key LIKE 'legacy.scheduled_task%'
          )
      `);
      const deleted = deleteStmt.run();
      console.log(`✓ Deleted: ${deleted.changes} records\n`);
    }

    // Mark cleanup as complete
    const now = new Date().toISOString();
    const upsertConfig = db.prepare(`
      INSERT INTO app_config (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `);
    upsertConfig.run(APP_CONFIG_KEY, now);
    console.log(`✓ Marked cleanup complete in app_config\n`);

    console.log('Cleanup finished successfully.');
  } catch (error) {
    console.error('❌ Cleanup failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    if (db) {
      db.close();
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
