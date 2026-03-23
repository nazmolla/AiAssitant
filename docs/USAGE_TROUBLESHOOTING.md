# Nexus Agent — Troubleshooting

> Back to [Usage Overview](USAGE.md)

---

> **Summary:** Common issues, diagnostics, and recovery steps for Nexus Agent.

---

## Notifications not appearing in the bell

### Symptoms
- Expected notifications (info, warnings) do not appear in the notification bell

### Checks
- Go to **Settings → Profile → Notification Level**
- If set to `high` or `disaster`, low-severity types (`info`, `warning`, `proactive_action`) are filtered out from the bell
- Lower the threshold to `low` (All notifications) to see everything
- Note: `approval_required` and `system_error` always appear regardless of threshold

---

## "Mark all as read" — notifications still visible elsewhere

### Expected behaviour
- "Mark all as read" dismisses all unread notifications from the bell entirely
- They are **not deleted** — they remain accessible in **Dashboard → Logs**

---

## Email monitoring not running

### Checks
- The email monitoring schedule (`workflow.email.pipeline`) is seeded **paused** by default — it requires an Email channel to be configured
- Go to **Settings → Channels** → add an Email channel (SMTP + IMAP)
- Then go to **Settings → Scheduler** → find "Email Monitoring" → click **Resume**
- If the schedule is not visible, check that you are logged in as an admin

---

## Display name shows wrong/stale name

### Symptoms
- Header or welcome screen shows an old name after updating profile

### Resolution
- The display name is fetched live from your profile on each page load
- Hard-refresh the page (`Ctrl+Shift+R` / `Cmd+Shift+R`) to force a fresh fetch
- Verify the name was saved: Settings → Profile → save and confirm the response is success

---

## UI briefly shows loading/flicker

### Symptoms
- Settings chips or tab content appear briefly empty, then populate

### Checks
- Measure latency for `/api/config/profile`
- Measure latency for `/api/admin/users/me`
- Confirm the client can read current session state promptly

---

## Tools missing in Tool Policies

### Checks
- Verify MCP server is connected
- Verify tool discovery completed
- Verify your role can see that scope (global vs user)

---

## Approval requests not appearing

### Checks
- Confirm tool policy has `requires_approval = true`
- Confirm action actually reaches gatekeeper path
- Confirm you are viewing your own user-scoped approvals
- **Proactive approvals** (created by the scheduler without a chat thread) are visible only to admins — check you are logged in as an admin
- Proactive approvals have a "Proactive" badge in the Approval Inbox to distinguish them from thread-bound approvals

---

## Smart home event classified with wrong severity

### Symptoms
- Receiving "disaster"-level emails for routine smart home device events (fans, lights, thermostats, etc.)

### Resolution
- Smart home/IoT tools (Hue, Nest, Ring) are now automatically capped at `high` severity — they can never produce `disaster`-level events
- If the issue persists, check `Dashboard → Logs` and filter by `source: scheduler` to review the actual severity assessment and whether it was capped

---

## Provider/channel credentials fail to decrypt

### Symptoms
- Existing saved credentials show decrypt failures in logs

### Checks
- Ensure `NEXUS_DB_SECRET` matches the key used at encryption time
- Re-save affected credentials via Settings if key changed

---

## Screenshot/documentation refresh flow

For refreshing docs screenshots from test environment:

1. Build app: `npx next build`
2. Start app: `npx next start -p 3001`
3. Run capture script with credentials:
   - `USAGE_EMAIL=<email>`
   - `USAGE_PASSWORD=<password>`
   - `node scripts/capture-usage-screenshots.mjs`
4. Stop local server after capture
