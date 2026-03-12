# Test Coverage Analysis: Why Scheduler Bugs Weren't Caught

## Executive Summary

Two critical bugs in Job Scout scheduling went undetected by the test suite because tests failed to replicate production data structures and didn't cover critical edge cases. The test suite exercises happy-path scenarios but lacks tests for scenarios involving unowned schedules and multi-user owner binding.

---

## Bug #1: Missing `owner_id` on Seeded Job Scout Schedule

### The Problem
Production seeds the Job Scout pipeline schedule with:
- `owner_type = 'system'`
- `owner_id = NULL`

When the scheduler engine executed Job Scout tasks, it threw:
```
Missing userId for job scout step "search". Set schedule owner_id.
```

### Why Tests Didn't Catch It

**Production Seed** (`src/lib/db/init.ts` line 695):
```sql
INSERT INTO scheduler_schedules (..., owner_type, owner_id, ...)
VALUES (?, ?, ?, 'system', NULL, ?, ...)
```

**Test Helper** (`tests/integration/api/scheduler-engine.test.ts` line 57-59):
```typescript
function insertSchedule(id: string, name: string, handlerType = "system.db_maintenance"): void {
  getDb().prepare(
    `INSERT INTO scheduler_schedules (..., owner_type, owner_id, ...)
     VALUES (?, ?, ?, 'user', ?, ?, ...)`
  ).run(id, `test.${id}`, name, ownerId, handlerType);
}
```

**The Disconnect:**
- Tests set: `owner_type = 'user'`, `owner_id = <seeded admin userId>`
- Production sets: `owner_type = 'system'`, `owner_id = NULL`

Test tables (lines 218-222) create Job Scout schedules using this helper, so all test Job Scout executions have an owner_id, masking the production problem.

**Root Cause:**  
No test validates that a Job Scout schedule **without an owner_id** fails appropriately. The engine code (line 248 in unified-engine.ts) throws an error, but that error path was never executed in tests because all test schedules had owners.

---

## Bug #2: Owner Set to Triggering Admin Instead of Target User

### The Problem
When the trigger endpoint was called without a user_id parameter, it auto-bound the owner to the triggering **admin** instead of the **user whose data** the Job Scout would process.

```typescript
// Old code (incorrect):
const needsOwnerBinding = schedule.handler_type === "workflow.job_scout" && !schedule.owner_id;
if (needsOwnerBinding) {
  updateSchedulerScheduleById(schedule.id, { owner_type: "user", owner_id: auth.user.id }); // ← admin's ID
}
```

For Job Scout batches processing user-specific data (resume, job search), this is wrong—the owner should be the user whose data is being processed, not the admin managing the batch.

### Why Tests Didn't Catch It

**Missing Test Coverage:**

1. **No trigger tests for Job Scout batches**: 
   - `scheduler-api.test.ts` tests the trigger endpoint (line 191), but only for "sched-api-1", which was created with explicit `owner_id = adminId` (line 37)
   - No test triggers a schedule **without** an owner_id

2. **No multi-user owner binding tests**:
   - No test passes a `user_id` parameter to the trigger endpoint
   - No test verifies that owner_id is set to a different user than the triggering admin

3. **Job Scout not exposed via public API**:
   - The `POST /api/scheduler/schedules` endpoint only accepts batch types: `proactive`, `knowledge`, `cleanup`, `email` (line 39 in `route.ts`)
   - Job Scout is a **seeded** pipeline, not creatable via API
   - This creates a blind spot: the trigger endpoint is never tested with Job Scout batches from the UI/API perspective

**Test File:** `tests/integration/api/scheduler-api.test.ts` line 191:
```typescript
test("trigger creates queued run and tasks", async () => {
  const triggerRes = await POST_TRIGGER(
    new NextRequest("http://localhost/api/scheduler/schedules/sched-api-1/trigger", { method: "POST" }),
    { params: Promise.resolve({ id: "sched-api-1" }) }
  );
  expect(triggerRes.status).toBe(200);
  // ...
});
```

This test:
- ✅ Verifies trigger endpoint returns 200
- ✅ Verifies run is created
- ❌ Never tests trigger **without** pre-set owner_id
- ❌ Never passes a `user_id` in request body
- ❌ Never validates that owner_id matches the request parameter (not the admin)

---

## Test Coverage Gaps

### Gap 1: Seeded Data Mismatch
**Issue:** Tests create test schedules with owners, but production seeds schedules without owners.

**Impact:** Owner-binding logic is never exercised by tests.

**Test Location:** `tests/integration/api/scheduler-engine.test.ts` lines 55-61

**Fix:**
Add an alternate `insertScheduleWithoutOwner()` helper and test that Job Scout execution fails with a clear error message:

```typescript
function insertScheduleWithoutOwner(id: string, name: string): void {
  getDb().prepare(
    `INSERT INTO scheduler_schedules (..., owner_type, owner_id, ...)
     VALUES (?, ?, ?, 'system', NULL, 'workflow.job_scout', ...)`
  ).run(id, `test.${id}`, name);
}

test("job scout fails with clear error when schedule has no owner_id", async () => {
  insertScheduleWithoutOwner("sched-no-owner", "Job Scout No Owner");
  insertTask("task-1", "sched-no-owner", "search", "...", "workflow.job_scout.search", 0);
  const run = createSchedulerRun("sched-no-owner", "api");
  createSchedulerTaskRun(run.id, "task-1");
  
  await runUnifiedSchedulerEngineTickForTests();
  
  const taskRun = getSchedulerTaskRunsForRun(run.id)[0];
  expect(taskRun.status).toBe("failed");
  expect(taskRun.error_message).toContain("Missing userId for job scout step");
});
```

### Gap 2: No Trigger Endpoint Tests for Unowned Schedules
**Issue:** Trigger endpoint tested only with pre-owned schedules.

**Impact:** Owner-binding on trigger is never validated; new multi-user logic untested.

**Test Location:** `tests/integration/api/scheduler-api.test.ts` line 191

**Fix:**
Add test for triggering unowned Job Scout schedule:

```typescript
test("trigger job scout batch without owner requires user_id parameter", async () => {
  const db = getDb();
  
  // Create unowned Job Scout schedule
  db.prepare(
    `INSERT INTO scheduler_schedules (...)
     VALUES (?, ?, ?, 'system', NULL, 'workflow.job_scout', ...)`
  ).run("sched-unowned-scout", "test.unowned_scout", "Job Scout Unowned", "workflow.job_scout");
  
  db.prepare(
    `INSERT INTO scheduler_tasks (...)
     VALUES (?, ?, ?, ?, ?, ...)`
  ).run("task-scout-1", "sched-unowned-scout", "search", "Search", "workflow.job_scout.search", 0, null, "{}");
  
  // Trigger WITHOUT user_id should fail
  const triggerNoUserIdRes = await POST_TRIGGER(
    new NextRequest("http://localhost/api/scheduler/schedules/sched-unowned-scout/trigger", { method: "POST" }),
    { params: Promise.resolve({ id: "sched-unowned-scout" }) }
  );
  expect(triggerNoUserIdRes.status).toBe(400);
  const errorBody = await triggerNoUserIdRes.json();
  expect(errorBody.error).toContain("user_id");
  
  // Trigger WITH user_id should succeed and bind owner
  const targetUserId = seedTestUser({ email: "target-user@test.com", role: "user" });
  const triggerWithUserIdRes = await POST_TRIGGER(
    new NextRequest("http://localhost/api/scheduler/schedules/sched-unowned-scout/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: targetUserId })
    }),
    { params: Promise.resolve({ id: "sched-unowned-scout" }) }
  );
  expect(triggerWithUserIdRes.status).toBe(200);
  
  // Verify schedule owner_id is now set to targetUserId, NOT the admin
  const updated = db.prepare("SELECT owner_id FROM scheduler_schedules WHERE id = ?").get("sched-unowned-scout") as { owner_id: string };
  expect(updated.owner_id).toBe(targetUserId);
  expect(updated.owner_id).not.toBe(adminId); // Verify it's NOT the triggering admin
});
```

### Gap 3: Job Scout Not Testable via Public API
**Issue:** Job Scout is a seeded pipeline, not creatable via `POST /api/scheduler/schedules`.

**Impact:** No end-to-end test of "user creates Job Scout batch via UI" → "admin triggers it with user_id" scenario.

**Impact:** The entire user journey is untested because Job Scout is **system-seeded**, not **user-created**.

**Current Behavior:**
```typescript
// Line 39 in src/app/api/scheduler/schedules/route.ts
if (!["proactive", "knowledge", "cleanup", "email"].includes(batchType)) {
  return NextResponse.json({ error: "batch_type must be one of proactive|knowledge|cleanup|email" }, { status: 400 });
}
```

**Note:** Job Scout isn't a batch_type option here. It's only accessed by directly seeding it. This creates a testing blind spot.

---

## Summary of Bugs vs. Test Coverage

| Bug | Why Not Caught | Test File | Missing Test |
|-----|---|---|---|
| **Bug #1:** Job Scout schedule created with `owner_id = NULL` causes "Missing userId" error | All tests set owner_id before executing Job Scout | `scheduler-engine.test.ts` | Test execution flow when owner_id is NULL |
| **Bug #2:** Trigger endpoint binds owner to admin instead of passing user parameter | No test triggers unowned schedules; no test passes `user_id` parameter | `scheduler-api.test.ts` | Test trigger with unowned schedule and `user_id` parameter |

---

## Recommendations

### Immediate Actions
1. ✅ Add test helper `insertScheduleWithoutOwner()` 
2. ✅ Add test for Job Scout execution failure with missing owner_id
3. ✅ Add test for trigger endpoint requiring `user_id` for unowned schedules
4. ✅ Add test validating owner_id is set to specified user_id, not triggering admin

### Structural Improvement
Make Job Scout creatable via API (or at least testable as a batch type) so the full user journey can be tested:

```typescript
// Proposed: Support 'job_scout' as a batch_type
["proactive", "knowledge", "cleanup", "email", "job_scout"].includes(batchType)
```

This would allow tests and users to:
- Create Job Scout batches with explicit owners
- Avoid the "hidden seeded schedule" pattern that bypassed testing

---

## Timeline
- **Production Issue:** Job Scout trigger failed with "Missing userId" error on 2026-03-12
- **Root Cause:** Seeded schedule had owner_id = NULL; trigger auto-bound to admin instead of target user
- **Detection:** Manual production debugging via SSH queries (not caught by automated tests)
- **Fix:** Owner-binding validation + user_id require parameter (commit 0b0fced)

---

---

# E2E & Browser-Interaction Coverage Analysis

## Executive Summary

The test suite does not replicate what a human tester would do when opening the application in a real browser. End-to-end (Playwright) coverage is effectively non-existent — two smoke tests that only check pages don't crash. Component tests stub all child components and only verify that navigation routes render the correct stub placeholder. The actual UI, forms, buttons, and interactive workflows are almost entirely untested at the interaction level.

---

## What a Human Tester Would Do

A human tester opening this application would follow these user flows. Each flow is cross-referenced against what the test suite actually covers.

### 1. Authentication

| Human Tester Action | Current Test Coverage |
|---|---|
| Navigate to `/`, get redirected to sign-in | ✅ Smoke test: checks sign-in renders |
| Type username + password, click Sign In | ❌ **Not tested** — E2E never submits credentials |
| See the app load after successful login | ❌ **Not tested** |
| Sign out and confirm session ends | ❌ **Not tested** |

### 2. Chat — Core Feature

| Human Tester Action | Current Test Coverage |
|---|---|
| See the chat panel load with thread sidebar | ❌ `chat-area.tsx` has **zero tests** |
| Type a message in the input bar and press Enter | ❌ `input-bar.tsx` has **zero tests** |
| See message appear in the conversation | ❌ **Not tested** |
| See the AI response stream in token-by-token | ❌ **Not tested** |
| Send a message with a file attachment | ❌ **Not tested** |
| See tool calls with approval prompts appear | ❌ `approval-inbox.tsx` has **no dedicated test** |
| Approve / reject a tool call | ❌ **Not tested** |

### 3. Thread Management

| Human Tester Action | Current Test Coverage |
|---|---|
| See the thread sidebar | ❌ `thread-sidebar.tsx` has **zero tests** |
| Create a new thread | ❌ **Not tested** |
| Switch between existing threads | ❌ **Not tested** |
| Rename a thread | ❌ **Not tested** |
| Delete a thread | ❌ **Not tested** |

### 4. Knowledge Vault

| Human Tester Action | Current Test Coverage |
|---|---|
| Navigate to Knowledge page | ✅ Navigation test: stub appears |
| See the knowledge vault UI load with entries | ⚠️ `component-render.test.tsx`: heading renders |
| Add a document / note | ❌ **Not tested** |
| Search through knowledge entries | ❌ **Not tested** |
| Delete a knowledge entry | ❌ **Not tested** |
| See knowledge referenced in chat responses | ❌ **Not tested** |

### 5. Settings — LLM Providers

| Human Tester Action | Current Test Coverage |
|---|---|
| Navigate to Settings → Providers | ✅ Navigation test: stub appears |
| See LLM provider list load | ⚠️ `component-render.test.tsx`: heading renders |
| Add a new LLM provider (fill URL, key, click Add) | ❌ **Not tested** |
| Delete an existing provider | ❌ **Not tested** |
| Select default provider | ❌ **Not tested** |

### 6. Settings — MCP Servers

| Human Tester Action | Current Test Coverage |
|---|---|
| Navigate to Settings → MCP Servers | ✅ Navigation test: stub appears |
| See connected/disconnected server list | ✅ `mcp-config.test.tsx`: status badges rendered |
| Type server name + URL, click Add & Connect | ✅ `mcp-config.test.tsx`: button disabled until filled, success path tested |
| Connect/disconnect existing server | ✅ `mcp-config.test.tsx`: connect and disconnect calls tested |
| Remove a server | ✅ `mcp-config.test.tsx`: DELETE call tested |
| **But still missing:** all of the above in a real browser end-to-end | ❌ All above tests use JSDOM, not a real browser |

### 7. Settings — Channels

| Human Tester Action | Current Test Coverage |
|---|---|
| Navigate to Settings → Channels | ✅ Navigation test: stub appears |
| See channel list | ⚠️ `component-render.test.tsx`: empty state message only |
| Add a Telegram/WhatsApp/etc. channel | ❌ **Not tested** |
| Test channel connection | ❌ **Not tested** |

### 8. Settings — Users (Admin)

| Human Tester Action | Current Test Coverage |
|---|---|
| Navigate to Settings → Users | ✅ Navigation test: stub appears |
| See user list render | ⚠️ `component-render.test.tsx`: user info renders |
| Create a new user | ❌ **Not tested** |
| Change a user's role or permissions | ❌ **Not tested** |
| Disable or delete a user | ❌ **Not tested** |

### 9. Settings — Authentication

| Human Tester Action | Current Test Coverage |
|---|---|
| Navigate to Settings → Authentication | ✅ Navigation test: stub appears |
| See OAuth provider list | ⚠️ `component-render.test.tsx`: heading renders |
| Add an OAuth provider | ❌ **Not tested** |
| Remove an OAuth provider | ❌ **Not tested** |
| Toggle local auth on/off | ❌ **Not tested** |

### 10. Batch Scheduler (Admin)

| Human Tester Action | Current Test Coverage |
|---|---|
| Navigate to Settings → Batch Scheduler | ✅ Navigation test: stub appears |
| See scheduler config with schedule list | ⚠️ `component-render.test.tsx`: headings only |
| Create a new batch | ❌ **Not tested** (UI interaction) |
| Trigger a schedule manually | ❌ **Not tested** (UI interaction — API tested separately) |
| Open scheduler console | ❌ `scheduler-console.tsx` has **zero tests** |
| View run history in console | ❌ **Not tested** |
| Trigger Job Scout with user_id from UI | ❌ **Not tested** |

### 11. Standing Orders

| Human Tester Action | Current Test Coverage |
|---|---|
| Navigate to Standing Orders | ❌ `standing-orders-config.tsx` has **zero tests** |
| Create a new standing order | ❌ **Not tested** |
| Edit / delete a standing order | ❌ **Not tested** |

### 12. DB Management (Admin)

| Human Tester Action | Current Test Coverage |
|---|---|
| Navigate to DB Management | ❌ `db-management-config.tsx` has **zero tests** |
| See database stats | ❌ **Not tested** |
| Run maintenance | ❌ **Not tested** |

### 13. Voice Conversation Mode

| Human Tester Action | Current Test Coverage |
|---|---|
| Navigate to Conversation page | ✅ Navigation test: stub appears |
| See idle state with mic button | ✅ `conversation-mode.test.tsx`: idle state tested |
| Click mic, grant microphone permission | ⚠️ `conversation-mode.test.tsx`: tests error case when no mediaDevices; happy path uses mocked audio API |
| Speak, see transcription appear | ❌ **Not tested in real browser** |
| Get AI response, hear it play back | ⚠️ `conversation-tts-transition.test.tsx`: TTS transitions tested with mocked Audio API |
| Interrupt AI during speech | ✅ `conversation-interrupt.test.tsx`: interrupt logic tested (mocked audio) |

### 14. Agent Dashboard

| Human Tester Action | Current Test Coverage |
|---|---|
| Navigate to Dashboard | ✅ Navigation test: stub appears |
| See analytics sections render | ✅ `agent-dashboard.test.tsx`: sections rendered |
| See live log stream update | ⚠️ Date/time format tested; live streaming not tested |
| Interact with any dashboard controls | ❌ **Not tested** |

---

## Component Coverage Inventory

### Components with Zero Tests

These components have no test file and are not meaningfully tested anywhere:

| Component | What it does | Risk |
|---|---|---|
| `chat-area.tsx` | Message list, streaming display, tool call rendering | **CRITICAL** — core feature |
| `input-bar.tsx` | Message composition, file attach, send button | **CRITICAL** — core feature |
| `thread-sidebar.tsx` | Thread list, create/switch/delete threads | **HIGH** |
| `approval-inbox.tsx` | Approve/reject tool calls (HITL) | **HIGH** — security-sensitive |
| `scheduler-console.tsx` | Batch run history, manual trigger UI | **HIGH** |
| `standing-orders-config.tsx` | Standing orders management | **MEDIUM** |
| `db-management-config.tsx` | Database maintenance UI | **MEDIUM** |
| `app-page-backbone.tsx` | Layout shell (indirectly covered via navigation stubs) | LOW |

### Components with Render-Only Tests (No Interaction)

These components have tests that verify they mount and show a heading. No form submissions, no button clicks, no data mutations are tested:

| Component | What's tested | What's missing |
|---|---|---|
| `llm-config.tsx` | Renders + "Add LLM Provider" heading | Add provider, delete, select default |
| `channels-config.tsx` | Renders + empty state message | Add channel, test connection |
| `auth-config.tsx` | Renders + "OAuth Providers" heading | Add OAuth provider, toggle local auth |
| `user-management.tsx` | Renders + user info | Edit role, disable, delete user |
| `custom-tools-config.tsx` | Renders + heading | Add tool, test tool, delete tool |
| `logging-config.tsx` | Renders + headings | Toggle logging, change log level |
| `whisper-config.tsx` | Renders + headings | Configure model path, test |
| `knowledge-vault.tsx` | Renders + heading | Add entry, search, delete |
| `api-keys-config.tsx` | Renders + "New API Key" button | Create key, view, revoke |
| `scheduler-config.tsx` | Renders + headings | Create batch, trigger, view results |
| `notification-bell.tsx` | Renders | Mark read, dismiss, click notification |
| `agent-dashboard.tsx` | Renders + date format | Live log updates, interactive controls |

### Components with Partial Interaction Coverage

These have some meaningful interaction tests but still have gaps:

| Component | What's tested | What's missing |
|---|---|---|
| `alexa-config.tsx` | Render, form validation, show/hide edit, cancel | Actual save API call success (fetch mock only) |
| `conversation-mode.tsx` | State machine, mic button, voice selector, auto-listen | Real microphone in browser, full send→response cycle |
| `mcp-config.tsx` | List, add & connect, connect/disconnect existing, remove | Edit server URL, bulk operations |
| `tool-policies.tsx` | (Specific coverage TBD) | Saving policy changes, per-tool overrides |
| `profile-config.tsx` | (Specific coverage TBD) | Avatar upload, theme change persist |
| `markdown-message.tsx` | Rendering of markdown formats | Long messages, code blocks with copy, links |

---

## The E2E (Playwright) Gap — Root Cause

The current Playwright test file (`tests/e2e/ui-smoke.spec.ts`) has exactly two tests:

```typescript
test("sign-in page renders without client-side exceptions", async ({ page }) => {
  await page.goto("/auth/signin");
  await expect(page.locator("text=Nexus")).toBeVisible();
  await expect(page.locator("button")).toBeVisible();
  // checks no CSP violations in console
});

test("root route loads and does not crash the client", async ({ page }) => {
  await page.goto("/");
  // checks no hydration errors in console
});
```

These tests open the app and check it doesn't immediately crash. They do not:
- Log in
- Send a message
- Interact with any feature
- Verify any data is created, updated, or saved

**The E2E layer is a health check, not a behaviour test.** A human tester spending 10 minutes manually testing the app would cover more scenarios than the entire Playwright suite.

---

## What "Navigation Tests" Actually Test

The `full-navigation.test.tsx` file (the most comprehensive component test with ~900 lines) is often assumed to cover the UI broadly. What it actually tests:

```
Click "Chat" in drawer → <div data-testid="chat-panel">Chat Panel</div> is visible  ✓
Click "Knowledge" in drawer → <div data-testid="knowledge-vault">Knowledge Vault</div> is visible  ✓
Click Settings → Providers chip → <div data-testid="llm-config">LLM Config</div> is visible  ✓
```

Every single child component — ChatPanel, ChatArea, InputBar, KnowledgeVault, LlmConfig, etc. — is replaced with a one-line `<div>` stub. The real components are never rendered. 

**What this means in practice:** These tests prove that navigation routing logic works correctly. They do not test anything the real components do. A regression in `chat-area.tsx` that makes messages disappear would pass all 13 component test files without any test failing.

---

## Coverage Matrix: Human Test Flow vs. Automated Tests

| User Flow | Unit | Integration | Component | E2E |
|---|---|---|---|---|
| Sign in with credentials | ❌ | ❌ | ❌ | ❌ (page renders only) |
| Sign out | ❌ | ❌ | ❌ | ❌ |
| Send a chat message | ❌ | ✅ (API only) | ❌ | ❌ |
| See AI response stream | ❌ | ✅ (SSE API only) | ❌ | ❌ |
| Upload file attachment | ❌ | ✅ (API only) | ❌ | ❌ |
| Approve / reject tool call | ❌ | ✅ (API only) | ❌ | ❌ |
| Create / switch threads | ❌ | ✅ (API only) | ❌ | ❌ |
| Add knowledge entry | ❌ | ✅ (API only) | ❌ | ❌ |
| Add LLM provider | ❌ | ✅ (API only) | ❌ | ❌ |
| Add MCP server | ❌ | ✅ (API only) | ✅ (JSDOM) | ❌ |
| Add channel | ❌ | ✅ (API only) | ❌ | ❌ |
| Manage users | ❌ | ✅ (API only) | ❌ | ❌ |
| Configure OAuth | ❌ | ✅ (API only) | ❌ | ❌ |
| Trigger batch job | ❌ | ✅ (API only) | ❌ | ❌ |
| View batch run console | ❌ | ❌ | ❌ | ❌ |
| Manage standing orders | ❌ | ❌ | ❌ | ❌ |
| Voice: start mic, speak | ❌ | ❌ | ✅ (mocked audio) | ❌ |
| Voice: hear AI response | ❌ | ❌ | ✅ (mocked audio) | ❌ |
| Voice: barge-in interrupt | ❌ | ❌ | ✅ (mocked audio) | ❌ |
| Permission gate (non-admin) | ❌ | ✅ (API only) | ✅ (chip visibility) | ❌ |

**Legend:** ✅ = tested | ⚠️ = partially tested | ❌ = not tested

---

## Playwright E2E Tests That Should Exist

The following are the highest-value Playwright tests for this application. Each represents a user journey a human tester would perform on every release:

### Critical (Must Have)

```
✦  E2E-01: Full login → chat → logout cycle
   - Navigate to app, get redirected to sign-in
   - Fill credentials, submit
   - See chat panel load
   - Type and send a message, see AI response
   - Sign out, confirm redirected to sign-in

✦  E2E-02: File attachment in chat
   - Login
   - Attach a file using the input bar
   - Send message referencing the file
   - See file preview in the conversation

✦  E2E-03: HITL tool approval
   - Login
   - Send a message that triggers a tool requiring approval
   - See the approval inbox populate
   - Click Approve
   - See the tool result appear in the response

✦  E2E-04: Thread management
   - Create a new thread
   - Send a message in it
   - Create another thread
   - Switch back to first thread, verify messages persist

✦  E2E-05: Settings save and persist
   - Navigate to Settings → Profile
   - Change display name
   - Save
   - Refresh the page
   - Verify the name persisted
```

### High Priority

```
✦  E2E-06: Knowledge vault CRUD
   - Navigate to Knowledge
   - Add a text entry
   - Search for it
   - Delete it

✦  E2E-07: MCP server add and connect (real browser)
   - Navigate to Settings → MCP Servers
   - Fill name and URL
   - Click Add & Connect
   - Verify the server appears in the list

✦  E2E-08: Admin — create and delete user
   - Login as admin
   - Navigate to Settings → Users
   - Create a new user
   - Set role to "user"
   - Save
   - Verify user appears in list
   - Delete the user
   - Verify they're gone

✦  E2E-09: Scheduler — trigger batch with user binding
   - Login as admin
   - Navigate to Settings → Batch Scheduler
   - Open scheduler console
   - Trigger Job Scout batch with a specified user_id
   - Verify run appears in console with status
```

### Medium Priority

```
✦  E2E-10: LLM provider add/remove
✦  E2E-11: Batch schedule create and pause/resume
✦  E2E-12: Permission-gated pages (non-admin cannot see admin pages)
✦  E2E-13: Voice conversation flow (with mocked browser audio)
✦  E2E-14: Notification bell — mark read
✦  E2E-15: API key generate and revoke
```

---

## Root Cause: Why the Testing Pyramid is Inverted

The test suite has good coverage at the **API layer** (25 integration test files covering all endpoints) and reasonable unit test coverage of pure functions — but virtually nothing at the **browser interaction layer**.

```
Current pyramid (inverted):

         [E2E — 2 smoke tests]        ← should be the smallest, is nearly empty
        [Component — 13 files]        ← mostly navigation stubs, not real interaction
      [Integration — 25 files]        ← strong API coverage
    [Unit — ~20 modules tested]       ← solid function-level coverage

Expected pyramid:

    [Unit — dense, fast]
   [Integration — thorough API layer]
  [Component — real interactions, JSDOM]
 [E2E — critical paths, real browser]
```

**The gap is structural:** Integration tests validate the server correctly handles requests. Component tests validate that navigation routing works. But no layer validates that when a user *types a message and presses Enter*, the right sequence of events happens in the browser, the API is called correctly, and the response is rendered properly.

This is why both scheduler bugs went to production: the bug was not in the API contract (which integration tests cover), but in the **data that was used when the UI triggered the API** — and no test simulated that exact user action.

---

## Recommended Testing Improvements

### Priority 1 — Fill Critical Component Gaps (2–4 weeks)

1. **`chat-area.test.tsx`** — Write tests for: message list renders, streaming tokens appear, tool call cards render, approval prompts appear
2. **`input-bar.test.tsx`** — Write tests for: typing text, submit on Enter, file attachment preview, send button state
3. **`thread-sidebar.test.tsx`** — Write tests for: thread list renders, new thread creation, switching threads

### Priority 2 — Promote Render-Only Tests to Interaction Tests (2–4 weeks)

For each component in the "render-only" category above, add at minimum:
- One test for the primary user action (e.g., "fill form and click Save, verify API is called")
- One test for the empty-state / error-state path
- One test for validation (required fields, format checks)

### Priority 3 — Write Playwright E2E Tests for Critical Paths (2–3 weeks)

Implement the 5 "Critical (Must Have)" E2E tests listed above using Playwright. These should:
- Run against a test environment with seeded data (use the existing SQLite test DB pattern)
- Run in CI on every push
- Block merge if they fail

### Priority 4 — Seed-Data Parity (Immediate, Low Effort)

Audit all test helpers (`insertSchedule`, `insertKnowledgeEntry`, etc.) for differences from production seeds. Any test helper that omits a field that is NULL in production is a potential blind spot. This is the exact class of bug that led to issues #103/#104.

---

## Summary

| Category | Current State | Target State |
|---|---|---|
| E2E (Playwright) | 2 smoke tests — page-doesn't-crash only | 5–15 critical-path tests covering real user flows |
| Component interactions | Navigation routing + a few isolated components | All 29 components with at minimum 1 interaction test each |
| Critical untested components | 8 components with zero tests | All reduced to zero |
| API layer | Strong (25 integration test files) | Maintain + add Job Scout UI journey test |
| Bugs caught before production | 0 of the last 2 scheduler bugs | Target: 100% for bugs with a defined test scenario |
