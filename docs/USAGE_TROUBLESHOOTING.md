# Nexus Agent — Troubleshooting

> Back to [Usage Overview](USAGE.md)

---

> **Summary:** Common issues, diagnostics, and recovery steps for Nexus Agent.

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
- Smart home/IoT tools (Alexa, Hue, Nest, Ring) are now automatically capped at `high` severity — they can never produce `disaster`-level events
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
