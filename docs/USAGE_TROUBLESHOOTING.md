# Nexus Agent — Troubleshooting

> Back to [Usage Overview](USAGE.md)

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
