# Cleanup Script: Legacy System Run-Once Schedules

## Summary
Removes legacy `trigger_type='once'` scheduler records from the migration to the unified scheduler engine. Safe to run multiple times (idempotent).

## File Location
```
scripts/cleanup-legacy-system-once-schedules.ts
```

## How It Works
1. Checks `app_config` for marker key `scheduler.cleanup_legacy_system_once_v1`
2. If marker exists: skips cleanup (already completed)
3. If marker doesn't exist:
   - Counts legacy `scheduler_schedules` records
   - Deletes records with `trigger_type='once' AND owner_type='system'`
   - Records completion timestamp in `app_config`

## Running Locally
```bash
npx ts-node scripts/cleanup-legacy-system-once-schedules.ts
```

## Running on Production
```bash
ssh user@prod-host 'cd /app && npx ts-node scripts/cleanup-legacy-system-once-schedules.ts'
```

## Verification
After running, check the app_config:
```sql
SELECT * FROM app_config WHERE key = 'scheduler.cleanup_legacy_system_once_v1';
```

Should return a row with the ISO timestamp of when cleanup completed.

## Safety
- **Idempotent**: Safe to run multiple times (marked via app_config)
- **Logged**: Records completion in app_config for audit trail
- **Non-destructive to active schedules**: Only targets legacy `trigger_type='once'` records
