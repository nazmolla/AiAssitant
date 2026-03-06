# Nexus Agent — Performance Audit Report

**Date:** 2026-03-06
**Version:** v0.44.19
**Auditor:** Automated codebase review (full-stack)

---

## Executive Summary

Full-stack performance review of the Nexus Agent codebase covering 5 layers: database/cache, LLM/agent orchestration, API routes, middleware, and frontend components. Identified **20 optimization opportunities** ranked by impact.

**Key metrics at time of audit:**
- 85 test suites, 1,037 tests (all passing)
- SQLite DB: 664 MB, 24 tables
- Production: AMD Ryzen 5 PRO 2400G, 4 cores, 9.6 GB RAM, NO GPU

---

## 🔴 CRITICAL — Fix Now (Measurable Impact)

### PERF-01: Blocking `fs.readFileSync()` in SSE Chat Route
- **File:** `src/app/api/threads/[threadId]/chat/route.ts` (Lines 122, 142, 148)
- **Problem:** Synchronous disk I/O blocks the Node.js event loop while reading attachment files. Under concurrency, all other requests queue behind a single file read (50–100ms+ penalty per file).
- **Fix:** Replace with `await fs.promises.readFile()` — straightforward swap.
- **Impact:** High — affects every chat request with attachments under concurrent load.

### PERF-02: Embedding Generation Not Cached
- **File:** `src/lib/llm/embeddings.ts` (Lines 5–14)
- **Problem:** Every knowledge query generates a fresh embedding via API call. 3 users asking the same question = 3 redundant API calls (100–500ms each).
- **Fix:** Hash-based embedding cache with 1-hour TTL keyed on query text.
- **Impact:** High — eliminates redundant LLM API calls on hot path.

### PERF-03: Vector Search is O(n) Full-Scan
- **File:** `src/lib/knowledge/retriever.ts` (Lines 73–90)
- **Problem:** Brute-force cosine similarity on entire knowledge vault. 1,000 entries = ~7.5M float operations (~50–100ms per search). No spatial indexing.
- **Fix:** Short-term: increase vault cache TTL from 30s → 300s. Long-term: FAISS/Milvus integration.
- **Impact:** High — directly impacts every knowledge-augmented response.

### PERF-04: Provider Instances Re-Created Per Request
- **File:** `src/lib/llm/index.ts` (Lines 23–80)
- **Problem:** `selectProvider()` creates a new OpenAI/Anthropic SDK client on every chat request. SDK clients include HTTP connection setup overhead.
- **Fix:** Cache provider instances keyed by provider config hash with 10s TTL.
- **Impact:** High — SDK instantiation overhead on every single chat request.

### PERF-05: Auth Queries Not Cached
- **File:** `src/lib/db/queries.ts` (Lines 32–36)
- **Problem:** `getUserByEmail()` and `getUserByExternalSub()` hit the DB on every login/OAuth flow — never cached. These are synchronous calls blocking the event loop.
- **Fix:** Add to `AppCache` with 5–10 min TTL + invalidation on user update.
- **Impact:** High — affects every authentication flow.

---

## 🟠 HIGH — Next Sprint (Scale Limiters)

### PERF-06: `dbMessagesToChat()` Rebuilds Entire History Every Loop Iteration
- **File:** `src/lib/agent/loop.ts` (Lines 972–1036)
- **Problem:** During multi-tool conversations, the agent loop re-parses the entire message history from DB on every iteration. 20-message thread × 5 iterations = 100+ `JSON.parse()` calls.
- **Fix:** Keep chat history in local state during the loop; only re-read from DB on continuation.
- **Impact:** Medium-High — repeated parsing and DB reads on the hottest path.

### PERF-07: N+1 Query in Notifications Route
- **File:** `src/app/api/notifications/route.ts` (Lines 20–35)
- **Problem:** Loops through all pending approvals, calling `getThread()` individually for each to verify ownership. 100 approvals = 100 `getThread()` queries. Auto-cleanup loop repeats the same pattern.
- **Fix:** Modify `listPendingApprovals()` to accept a `userId` filter, or JOIN threads in the query.
- **Impact:** Medium-High — quadratic query explosion at scale.

### PERF-08: No Pagination on Thread/Knowledge Listings
- **Files:** `src/app/api/threads/route.ts` (Line 20), `src/lib/db/queries.ts` (multiple)
- **Problem:** 9+ queries fetch ALL rows with no `LIMIT` clause: `listUsers()`, `listKnowledge()`, `searchKnowledge()`, `listMcpServers()`, `listChannels()`, `listAuthProviders()`, `listCustomTools()`, `listAllApiKeys()`, `listThreads()`.
- **Fix:** Add `LIMIT`/`OFFSET` pagination; return page metadata.
- **Impact:** Medium-High — memory/serialization cost grows linearly with data.

### PERF-09: Worker Thread Spawned Per Request (No Pool)
- **File:** `src/lib/agent/worker-manager.ts` (Lines 73–150)
- **Problem:** Each chat message spawns a new worker thread (10–50ms overhead). Multi-tool loops waste 30–150ms cumulative.
- **Fix:** Worker pool of 2–4 reusable workers.
- **Impact:** Medium — consistent latency improvement per request.

### PERF-10: Knowledge Retrieval on Trivial Messages
- **File:** `src/lib/agent/loop.ts` (Line 195)
- **Problem:** Even "ok", "thanks", "yes" trigger embedding generation + vault search if the vault has entries. `needsKnowledgeRetrieval()` heuristic exists but is checked AFTER vault existence check.
- **Fix:** Check `needsKnowledgeRetrieval()` BEFORE `hasKnowledgeEntries()` to skip trivial messages early.
- **Impact:** Medium — saves 100–500ms per trivial turn.

### PERF-11: `searchKnowledge()` Uses LIKE on Unindexed Columns
- **File:** `src/lib/db/queries.ts` (Lines 631–640)
- **Problem:** `entity LIKE ? OR attribute LIKE ? OR value LIKE ?` with no indexes. Full table scan on large vaults.
- **Fix:** Add indexes on `user_knowledge(entity)`, `user_knowledge(attribute)`, or implement FTS5.
- **Impact:** Medium — degrades with vault size.

---

## 🟡 MEDIUM — Quality Improvements

### PERF-12: Monolithic `ChatPanel` Component (14+ State Variables)
- **File:** `src/components/chat-panel.tsx` (Lines 134–168)
- **Problem:** `threads`, `messages`, `recording`, `audioMode`, `screenStream`, etc. all in one component. A single keystroke re-renders the thread sidebar, message list, and input area simultaneously.
- **Fix:** Split into `ThreadSidebar`, `ChatArea`, `InputBar` subcomponents with isolated state.
- **Impact:** Medium — improved UI responsiveness.

### PERF-13: No Message List Virtualization
- **File:** `src/components/chat-panel.tsx` (Lines 1095–1319)
- **Problem:** Messages rendered in flat `.map()` — 100+ messages keep all DOM nodes alive.
- **Fix:** Use `react-window` or `@tanstack/react-virtual` for windowed rendering.
- **Impact:** Medium — significant for long conversations.

### PERF-14: Rate Limiter `ipHits` Map Grows Unbounded Between Cleanups
- **File:** `src/middleware.ts` (Lines 8–28)
- **Problem:** Cleanup runs every 5 minutes; between cleanups, unique IPs accumulate with no cap. Under DDoS or bot crawling, this can consume significant memory.
- **Fix:** Reduce cleanup to 60s, or add LRU eviction at 10K entries.
- **Impact:** Medium — memory safety under adversarial conditions.

### PERF-15: LLM Provider Deletion Does 4 Sequential DB Queries
- **File:** `src/lib/db/queries.ts` (Lines 520–530)
- **Problem:** `getLlmProvider()` → `DELETE` → `SELECT fallback` → `setDefaultLlmProvider()` — 4 roundtrips.
- **Fix:** Wrap in a single `db.transaction()` call.
- **Impact:** Low-Medium — rare operation but correctness improvement.

### PERF-16: Per-Row AES-256-GCM Decryption Without Batching
- **File:** `src/lib/db/crypto.ts` + `src/lib/db/queries.ts` (Line 420)
- **Problem:** `listChannels()`, `listAuthProviders()`, `listMcpServers()` decrypt each row individually in a `.map()` loop.
- **Fix:** Cache decrypted results in AppCache since these change rarely; invalidate on mutations.
- **Impact:** Low-Medium — CPU-bound decryption per row.

### PERF-17: `getRecentLogs()` Falls Back to Unbounded Query
- **File:** `src/lib/db/queries.ts` (Lines 972–1002)
- **Problem:** When `limit` is `NaN` or `Infinity`, executes `SELECT * FROM agent_logs ORDER BY created_at DESC` with NO LIMIT.
- **Fix:** Default to a sensible max (e.g., 1000).
- **Impact:** Low-Medium — potential memory spike on admin pages.

### PERF-18: Thread Fetch Spam on Events
- **File:** `src/components/chat-panel.tsx` (Lines 554–558)
- **Problem:** `fetch("/api/threads")` called on mount, on every message receive, and on every approval-resolved event — no deduplication. Multiple simultaneous fetch calls can race.
- **Fix:** Debounce or use SWR/TanStack Query for automatic dedup + stale-while-revalidate.
- **Impact:** Low-Medium — unnecessary network traffic.

### PERF-19: File Preview URL Memory Leak
- **File:** `src/components/chat-panel.tsx` (Lines 620–646)
- **Problem:** `URL.createObjectURL()` for image previews not revoked until file removed or message sent. Multiple pending files = orphaned blob URLs.
- **Fix:** Revoke on unmount via `useEffect` cleanup.
- **Impact:** Low — memory leak in browser over long sessions.

### PERF-20: Verbose Logging on Read Operations
- **File:** `src/app/api/threads/route.ts` (Lines 22–25)
- **Problem:** `addLog()` DB write for every GET thread list and POST create — at 120 req/min that's 3,600+ log entries/hour.
- **Fix:** Remove read-path logging or make it conditional on debug mode.
- **Impact:** Low — DB write contention and log table bloat.

---

## Quick Wins Summary

| # | Change | Est. Savings | File(s) |
|---|--------|-------------|---------|
| 1 | `fs.readFileSync` → `await fs.promises.readFile` | 50–100ms/req with attachments | `chat/route.ts` |
| 2 | Increase vault cache TTL: 30s → 300s | Eliminates 90%+ vault re-parses | `retriever.ts` |
| 3 | Check `needsKnowledgeRetrieval()` BEFORE `hasKnowledgeEntries()` | Saves 100–500ms on trivial msgs | `loop.ts` |
| 4 | Cache `getUserByEmail()` / `getUserByExternalSub()` | Saves 5–10ms per auth flow | `queries.ts` |
| 5 | Default `getRecentLogs()` limit to 1000 | Prevents unbounded log dumps | `queries.ts` |
| 6 | Reduce rate limiter cleanup: 5min → 60s | Bounds memory growth | `middleware.ts` |

---

## GitHub Issue Tracking

| PERF # | Issue | Severity |
|--------|-------|----------|
| PERF-01 | [#2](https://github.com/mnazmianth/AiAssitant/issues/2) | 🔴 Critical |
| PERF-02 | [#3](https://github.com/mnazmianth/AiAssitant/issues/3) | 🔴 Critical |
| PERF-03 | [#4](https://github.com/mnazmianth/AiAssitant/issues/4) | 🔴 Critical |
| PERF-04 | [#5](https://github.com/mnazmianth/AiAssitant/issues/5) | 🔴 Critical |
| PERF-05 | [#6](https://github.com/mnazmianth/AiAssitant/issues/6) | 🔴 Critical |
| PERF-06 | [#7](https://github.com/mnazmianth/AiAssitant/issues/7) | 🟠 High |
| PERF-07 | [#8](https://github.com/mnazmianth/AiAssitant/issues/8) | 🟠 High |
| PERF-08 | [#9](https://github.com/mnazmianth/AiAssitant/issues/9) | 🟠 High |
| PERF-09 | [#10](https://github.com/mnazmianth/AiAssitant/issues/10) | 🟠 High |
| PERF-10 | [#11](https://github.com/mnazmianth/AiAssitant/issues/11) | 🟠 High |
| PERF-11 | [#12](https://github.com/mnazmianth/AiAssitant/issues/12) | 🟠 High |
| PERF-12 | [#13](https://github.com/mnazmianth/AiAssitant/issues/13) | 🟡 Medium |
| PERF-13 | [#14](https://github.com/mnazmianth/AiAssitant/issues/14) | 🟡 Medium |
| PERF-14 | [#15](https://github.com/mnazmianth/AiAssitant/issues/15) | 🟡 Medium |
| PERF-15 | [#16](https://github.com/mnazmianth/AiAssitant/issues/16) | 🟡 Medium |
| PERF-16 | [#17](https://github.com/mnazmianth/AiAssitant/issues/17) | 🟡 Medium |
| PERF-17 | [#18](https://github.com/mnazmianth/AiAssitant/issues/18) | 🟡 Medium |
| PERF-18 | [#19](https://github.com/mnazmianth/AiAssitant/issues/19) | 🟡 Medium |
| PERF-19 | [#20](https://github.com/mnazmianth/AiAssitant/issues/20) | 🟡 Medium |
| PERF-20 | [#21](https://github.com/mnazmianth/AiAssitant/issues/21) | 🟡 Medium |

---

## Implementation Plan

### Phase 1: Quick Wins (Same Day)
*Zero-risk, high-reward changes — no architectural impact.*

| Order | Item | Issue | Risk | Dependency |
|-------|------|-------|------|------------|
| 1 | PERF-01: `readFileSync` → async | [#2](https://github.com/mnazmianth/AiAssitant/issues/2) | None | None |
| 2 | PERF-10: Reorder knowledge retrieval checks | [#11](https://github.com/mnazmianth/AiAssitant/issues/11) | None | None |
| 3 | PERF-17: Default `getRecentLogs()` limit | [#18](https://github.com/mnazmianth/AiAssitant/issues/18) | None | None |
| 4 | PERF-20: Remove read-path logging | [#21](https://github.com/mnazmianth/AiAssitant/issues/21) | None | None |
| 5 | PERF-14: Rate limiter cleanup interval | [#15](https://github.com/mnazmianth/AiAssitant/issues/15) | None | None |
| 6 | PERF-19: Blob URL revocation | [#20](https://github.com/mnazmianth/AiAssitant/issues/20) | None | None |
| 7 | PERF-15: Provider deletion transaction | [#16](https://github.com/mnazmianth/AiAssitant/issues/16) | Low | None |

### Phase 2: Critical Caching (Sprint 1)
*Core caching additions — highest latency impact.*

| Order | Item | Issue | Risk | Dependency |
|-------|------|-------|------|------------|
| 1 | PERF-05: Cache auth queries | [#6](https://github.com/mnazmianth/AiAssitant/issues/6) | Low | None |
| 2 | PERF-04: Cache provider instances | [#5](https://github.com/mnazmianth/AiAssitant/issues/5) | Low | None |
| 3 | PERF-02: Cache embedding results | [#3](https://github.com/mnazmianth/AiAssitant/issues/3) | Low | None |
| 4 | PERF-16: Cache decrypted rows | [#17](https://github.com/mnazmianth/AiAssitant/issues/17) | Low | None |
| 5 | PERF-03: Increase vault cache TTL | [#4](https://github.com/mnazmianth/AiAssitant/issues/4) | Low | PERF-02 |

### Phase 3: Query & Loop Optimization (Sprint 2)
*Database and agent loop improvements — moderate complexity.*

| Order | Item | Issue | Risk | Dependency |
|-------|------|-------|------|------------|
| 1 | PERF-11: Add knowledge search indexes | [#12](https://github.com/mnazmianth/AiAssitant/issues/12) | Low | None |
| 2 | PERF-07: Fix N+1 notifications query | [#8](https://github.com/mnazmianth/AiAssitant/issues/8) | Med | None |
| 3 | PERF-06: Keep chat history in loop state | [#7](https://github.com/mnazmianth/AiAssitant/issues/7) | Med | None |
| 4 | PERF-08: Add query pagination | [#9](https://github.com/mnazmianth/AiAssitant/issues/9) | Med | Frontend changes |
| 5 | PERF-18: Debounce thread fetches | [#19](https://github.com/mnazmianth/AiAssitant/issues/19) | Low | None |

### Phase 4: Architecture (Sprint 3+)
*Larger refactoring — requires design review.*

| Order | Item | Issue | Risk | Dependency |
|-------|------|-------|------|------------|
| 1 | PERF-09: Worker thread pool | [#10](https://github.com/mnazmianth/AiAssitant/issues/10) | Med | None |
| 2 | PERF-12: Split ChatPanel | [#13](https://github.com/mnazmianth/AiAssitant/issues/13) | Med | None |
| 3 | PERF-13: Message virtualization | [#14](https://github.com/mnazmianth/AiAssitant/issues/14) | Med | PERF-12 |

### Implementation Notes
- **Phase 1** items are safe to implement in sequence and deploy together in one release
- **Phase 2** items each need their own PR with cache invalidation tests
- **Phase 3** items 2–4 touch the hot path (agent loop, DB queries) — deploy individually with monitoring
- **Phase 4** requires design review; PERF-13 depends on PERF-12 being complete first
- Run full test suite (`npx jest --forceExit`) after each change
- Deploy via `deploy.sh` and verify with `journalctl -u nexus-agent` after each phase
