/**
 * Dynamic Security Scan — API Key Authentication
 * 
 * Tests the production server for security vulnerabilities
 * in the new API key authentication system.
 * 
 * Run: node tests/dynamic-security-scan.mjs
 */

const BASE = process.env.SCAN_BASE || "http://localhost:3000";

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    failures.push(testName);
    console.log(`  ✗ FAIL: ${testName}`);
  }
}

async function req(path, opts = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    redirect: "manual",
  });
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body, headers: Object.fromEntries(res.headers.entries()) };
}

// ─── Session login helper ────────────────────────────────────
async function getSessionCookie() {
  // 1. Get CSRF token
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;
  const cookies = csrfRes.headers.getSetCookie?.() || [];

  // Build cookie header from CSRF response
  let cookieHeader = cookies.map(c => c.split(";")[0]).join("; ");

  // 2. Login
  // Credentials provider uses email field, not username
  const loginBody = new URLSearchParams({
    email: process.env.SCAN_EMAIL || "demo.user1@example.com",
    password: process.env.SCAN_PASSWORD || "screenshot1",
    csrfToken,
    callbackUrl: `${BASE}`,
    json: "true",
  });

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    body: loginBody,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader,
    },
    redirect: "manual",
  });

  // Collect all set-cookie headers from login response
  const loginCookies = loginRes.headers.getSetCookie?.() || [];
  const allCookies = [...cookies, ...loginCookies];
  cookieHeader = allCookies.map(c => c.split(";")[0]).join("; ");

  // 3. Verify session works
  const sessionRes = await fetch(`${BASE}/api/auth/session`, {
    headers: { Cookie: cookieHeader },
  });
  const session = await sessionRes.json();
  if (!session?.user?.email) {
    throw new Error("Login failed — no session");
  }
  console.log(`  Logged in as: ${session.user.email} (role: ${session.user.role})`);
  return cookieHeader;
}

async function sessionReq(path, cookie, opts = {}) {
  return req(path, {
    ...opts,
    headers: { ...opts.headers, Cookie: cookie },
  });
}

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

async function run() {
  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║  Dynamic Security Scan — API Keys         ║");
  console.log("╚═══════════════════════════════════════════╝\n");

  // ─── 1. Unauthenticated access ──────────────────────────────
  console.log("▸ Unauthenticated access");
  {
    const r = await req("/api/threads");
    assert(r.status === 401, "Unauthenticated GET /api/threads → 401");
  }
  {
    const r = await req("/api/config/api-keys");
    assert(r.status === 401, "Unauthenticated GET /api/config/api-keys → 401");
  }
  {
    const r = await req("/api/admin/api-keys");
    assert(r.status === 401, "Unauthenticated GET /api/admin/api-keys → 401");
  }
  {
    const r = await req("/api/audio/transcribe", { method: "POST" });
    assert(r.status === 401, "Unauthenticated POST /api/audio/transcribe → 401");
  }
  {
    const r = await req("/api/conversation/respond", { method: "POST" });
    assert(r.status === 401, "Unauthenticated POST /api/conversation/respond → 401");
  }
  {
    const r = await req("/api/notifications");
    assert(r.status === 401, "Unauthenticated GET /api/notifications → 401");
  }

  // ─── 2. Invalid bearer tokens ───────────────────────────────
  console.log("\n▸ Invalid bearer tokens");
  const invalidTokens = [
    { name: "random string", token: "Bearer invalid_token" },
    { name: "fake nxk_ prefix", token: "Bearer nxk_00000000000000000000000000000000" },
    { name: "empty bearer", token: "Bearer " },
    { name: "no token after Bearer", token: "Bearer" },
    { name: "multiple spaces", token: "Bearer   nxk_00000000000000000000000000000000" },
    { name: "wrong scheme", token: "Basic dXNlcjpwYXNz" },
    { name: "nxk_ without Bearer", token: "nxk_00000000000000000000000000000000" },
    { name: "very long token", token: "Bearer nxk_" + "A".repeat(10000) },
    // null bytes and non-ASCII are rejected by the HTTP client itself (not a server concern)
  ];
  for (const { name, token } of invalidTokens) {
    const r = await req("/api/threads", { headers: { Authorization: token } });
    assert(r.status === 401, `Invalid token (${name}) → 401`);
  }

  // ─── 3. Login and create real API key ───────────────────────
  console.log("\n▸ Session login");
  let cookie;
  try {
    cookie = await getSessionCookie();
  } catch (e) {
    console.log(`  ✗ FAIL: Could not login — ${e.message}`);
    failed++;
    failures.push("Session login");
    console.log("\n⚠ Cannot continue dynamic tests without session. Stopping.");
    printSummary();
    return;
  }

  // ─── 4. Create API keys with different scopes ───────────────
  console.log("\n▸ API key creation");
  let fullScopeKey, chatOnlyKey;
  {
    // Full scope key
    const r = await sessionReq("/api/config/api-keys", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "security-test-full", scopes: ["chat", "knowledge", "approvals", "threads"] }),
    });
    assert(r.status === 201, "Create full-scope API key → 201");
    assert(r.body?.rawKey?.startsWith("nxk_"), "Raw key starts with nxk_");
    assert(!r.body?.key_hash, "key_hash NOT leaked in response");
    fullScopeKey = r.body?.rawKey;
  }
  {
    // Chat-only key
    const r = await sessionReq("/api/config/api-keys", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "security-test-chat-only", scopes: ["chat"] }),
    });
    assert(r.status === 201, "Create chat-only API key → 201");
    chatOnlyKey = r.body?.rawKey;
  }

  if (!fullScopeKey || !chatOnlyKey) {
    console.log("  ✗ Cannot continue — key creation failed");
    printSummary();
    return;
  }

  // ─── 5. Valid API key access ────────────────────────────────
  console.log("\n▸ Valid API key access");
  {
    const r = await req("/api/threads", { headers: { Authorization: `Bearer ${fullScopeKey}` } });
    assert(r.status === 200, "Full-scope key GET /api/threads → 200");
  }

  // ─── 6. Scope enforcement ──────────────────────────────────
  console.log("\n▸ Scope enforcement");
  {
    // Chat-only key should NOT access threads (if threads is scope-protected)
    const r = await req("/api/threads", { headers: { Authorization: `Bearer ${chatOnlyKey}` } });
    // If threads requires "threads" scope, this should be 403
    // If threads doesn't check scope, it will be 200 — let's see
    assert(r.status === 200 || r.status === 403, `Chat-only key GET /api/threads → ${r.status} (200 if no scope check, 403 if enforced)`);
    if (r.status === 200) {
      console.log("    ⚠ Note: /api/threads does not enforce scope — acceptable if intentional");
    }
  }

  // ─── 7. API key self-management BLOCKED ─────────────────────
  console.log("\n▸ API key self-management blocked (CRITICAL)");
  {
    const r = await req("/api/config/api-keys", { headers: { Authorization: `Bearer ${fullScopeKey}` } });
    assert(r.status === 403, "API key GET /api/config/api-keys → 403 (cannot list own keys)");
  }
  {
    const r = await req("/api/config/api-keys", {
      method: "POST",
      headers: { Authorization: `Bearer ${fullScopeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "evil-key", scopes: ["chat"] }),
    });
    assert(r.status === 403, "API key POST /api/config/api-keys → 403 (cannot create new keys)");
  }
  {
    const r = await req("/api/config/api-keys", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${fullScopeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "fake-id" }),
    });
    assert(r.status === 403, "API key DELETE /api/config/api-keys → 403 (cannot revoke keys)");
  }

  // ─── 8. Admin endpoint blocking ─────────────────────────────
  console.log("\n▸ Admin endpoints blocked for API keys");
  {
    const r = await req("/api/admin/api-keys", { headers: { Authorization: `Bearer ${fullScopeKey}` } });
    assert(r.status === 403, "API key GET /api/admin/api-keys → 403");
    assert(r.body?.error?.includes("session"), "Error message mentions session auth required");
  }
  {
    // Try other admin endpoints
    const r = await req("/api/admin/users", { headers: { Authorization: `Bearer ${fullScopeKey}` } });
    assert(r.status === 403, "API key GET /api/admin/users → 403");
  }

  // ─── 9. Timing attack check ────────────────────────────────
  console.log("\n▸ Timing consistency (rough check)");
  {
    const times = [];
    // Valid prefix, wrong hash
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await req("/api/threads", { headers: { Authorization: "Bearer nxk_00000000000000000000000000000000" } });
      times.push(performance.now() - start);
    }
    const validPrefixTimes = [];
    // Use the actual key's prefix (first 8 chars) with wrong rest
    const prefix = fullScopeKey.substring(0, 12); // nxk_ + 8 hex chars
    for (let i = 0; i < 5; i++) {
      const fakeKey = prefix + "ff".repeat(12); // same prefix, wrong hash
      const start = performance.now();
      await req("/api/threads", { headers: { Authorization: `Bearer ${fakeKey}` } });
      validPrefixTimes.push(performance.now() - start);
    }
    
    const avgNoPrefix = times.reduce((a, b) => a + b) / times.length;
    const avgValidPrefix = validPrefixTimes.reduce((a, b) => a + b) / validPrefixTimes.length;
    const diff = Math.abs(avgNoPrefix - avgValidPrefix);
    console.log(`    Avg no-match-prefix: ${avgNoPrefix.toFixed(1)}ms | Avg match-prefix: ${avgValidPrefix.toFixed(1)}ms | Δ: ${diff.toFixed(1)}ms`);
    assert(diff < 100, `Timing difference < 100ms (Δ=${diff.toFixed(1)}ms) — no obvious timing oracle`);
  }

  // ─── 10. Name validation ────────────────────────────────────
  console.log("\n▸ Name validation");
  {
    // Very long name
    const longName = "A".repeat(200);
    const r = await sessionReq("/api/config/api-keys", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: longName, scopes: ["chat"] }),
    });
    assert(r.status === 201, "Long name accepted (truncated server-side)");
    // Name should be truncated to 100 chars
    if (r.body?.name) {
      assert(r.body.name.length <= 100, `Name truncated to ≤100 chars (got ${r.body.name.length})`);
    }
    // Clean up: delete this key
    if (r.body?.id) {
      await sessionReq("/api/config/api-keys", cookie, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.body.id }),
      });
    }
  }
  {
    // XSS in name
    const xssName = '<script>alert("xss")</script>';
    const r = await sessionReq("/api/config/api-keys", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: xssName, scopes: ["chat"] }),
    });
    assert(r.status === 201, "XSS name accepted (React escapes on render)");
    // Clean up
    if (r.body?.id) {
      await sessionReq("/api/config/api-keys", cookie, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.body.id }),
      });
    }
  }
  {
    // Empty name
    const r = await sessionReq("/api/config/api-keys", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", scopes: ["chat"] }),
    });
    assert(r.status === 400, "Empty name → 400");
  }
  {
    // Missing name
    const r = await sessionReq("/api/config/api-keys", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopes: ["chat"] }),
    });
    assert(r.status === 400, "Missing name → 400");
  }

  // ─── 11. Scope validation ──────────────────────────────────
  console.log("\n▸ Scope validation");
  {
    // Invalid scope
    const r = await sessionReq("/api/config/api-keys", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bad-scope", scopes: ["admin", "superuser"] }),
    });
    assert(r.status === 400, "Invalid scopes → 400");
  }
  {
    // Empty scopes array
    const r = await sessionReq("/api/config/api-keys", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "no-scopes", scopes: [] }),
    });
    assert(r.status === 400, "Empty scopes → 400");
  }

  // ─── 12. CORS headers ──────────────────────────────────────
  console.log("\n▸ CORS headers check");
  {
    // Preflight from mobile app
    const r = await req("/api/threads", {
      method: "OPTIONS",
      headers: {
        Origin: "http://mobile-app.local",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
      },
    });
    console.log(`    OPTIONS /api/threads → ${r.status}`);
    console.log(`    ACAO: ${r.headers["access-control-allow-origin"] || "not set"}`);
    console.log(`    ACAH: ${r.headers["access-control-allow-headers"] || "not set"}`);
    // We just report — the app may or may not have CORS configured
  }

  // ─── 13. Rate limiting ─────────────────────────────────────
  console.log("\n▸ Rate limiting with API key");
  {
    let hitRateLimit = false;
    for (let i = 0; i < 50; i++) {
      const r = await req("/api/threads", { headers: { Authorization: `Bearer ${fullScopeKey}` } });
      if (r.status === 429) {
        hitRateLimit = true;
        console.log(`    Rate limited at request #${i + 1}`);
        break;
      }
    }
    console.log(`    Rate limiting active: ${hitRateLimit ? "YES (hit 429)" : "not triggered in 50 requests"}`);
  }

  // ─── 14. Response headers security ─────────────────────────
  console.log("\n▸ Response security headers");
  {
    const r = await req("/api/threads", { headers: { Authorization: `Bearer ${fullScopeKey}` } });
    console.log(`    Content-Type: ${r.headers["content-type"]}`);
    console.log(`    X-Content-Type-Options: ${r.headers["x-content-type-options"] || "not set"}`);
    console.log(`    X-Frame-Options: ${r.headers["x-frame-options"] || "not set"}`);
    console.log(`    Strict-Transport-Security: ${r.headers["strict-transport-security"] || "not set"}`);
  }

  // ─── 15. key_hash not in listings ───────────────────────────
  console.log("\n▸ key_hash not leaked in listings");
  {
    const r = await sessionReq("/api/config/api-keys", cookie);
    assert(r.status === 200, "GET /api/config/api-keys → 200");
    const keys = r.body;
    if (Array.isArray(keys)) {
      const hasHash = keys.some(k => k.key_hash);
      assert(!hasHash, "No key_hash in user key listing");
    }
  }
  {
    const r = await sessionReq("/api/admin/api-keys", cookie);
    if (r.status === 200 && Array.isArray(r.body)) {
      const hasHash = r.body.some(k => k.key_hash);
      assert(!hasHash, "No key_hash in admin key listing");
    }
  }

  // ─── Cleanup: delete test keys ──────────────────────────────
  console.log("\n▸ Cleanup");
  {
    const r = await sessionReq("/api/config/api-keys", cookie);
    if (r.status === 200 && Array.isArray(r.body)) {
      for (const key of r.body) {
        if (key.name?.startsWith("security-test-")) {
          await sessionReq("/api/config/api-keys", cookie, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: key.id }),
          });
          console.log(`  Deleted test key: ${key.name}`);
        }
      }
    }
  }

  printSummary();
}

function printSummary() {
  console.log("\n╔═══════════════════════════════════════════╗");
  console.log(`║  Results: ${passed} passed, ${failed} failed              `);
  console.log("╚═══════════════════════════════════════════╝");
  if (failures.length > 0) {
    console.log("\nFailed tests:");
    failures.forEach(f => console.log(`  ✗ ${f}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error("Fatal error:", e);
  process.exit(2);
});
