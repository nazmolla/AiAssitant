## Bug Report

**Problem:** The default notification_level in the user profile schema is "disaster", but no notification call site ever emits at disaster level. All notifications use "medium" (approvals, general email) or "high" (security emails) or "low" (system emails). Result: every notification is silently suppressed for users who have not explicitly changed their profile setting.

**Use Case:** As a user on default settings, I should receive approval notifications, security alerts, and other important system notifications without manually adjusting my profile.

**Acceptance Criteria:**
1. Change default notification_level from "disaster" to "medium" in DB schema, EMPTY_PROFILE, and profile upsert fallback
2. Existing users with "disaster" threshold get migrated to "medium" via DB migration
3. Unit tests validate shouldNotifyForLevel() logic at all threshold/event combinations
4. Unit tests validate that the default profile includes a sensible notification_level
5. Documentation updated to reflect the change

**Technical Notes:**
- Affected files: schema.ts, init.ts, user-queries.ts, use-profile-data.ts, notify.ts
- The scheduler digest filtering in scheduler/index.ts uses the same logic and is equally affected
- No existing tests cover the notification threshold filtering

**Test Considerations:**
- Unit tests for shouldNotifyForLevel() across all 4x4 threshold/event combinations
- Unit test for normalizeNotificationLevel() edge cases
- Unit test verifying EMPTY_PROFILE default
- Integration-level validation that notifyAdmin delivers when threshold allows
