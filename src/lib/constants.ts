/**
 * Centralized operational constants for the Nexus Agent platform.
 *
 * This module consolidates magic numbers and tunable parameters that were
 * previously scattered across core modules. Group constants by subsystem
 * and keep them importable from a single location.
 */

/* ── Agent Loop ───────────────────────────────────────────────────── */

/** Max tool-call iterations per agent turn before forced exit */
export const MAX_TOOL_ITERATIONS = 25;

/** Max characters of tool output before truncation */
export const TOOL_RESULT_TRUNCATION_LIMIT = 15_000;

/** HTML marker prefix for inline approval payloads */
export const INLINE_APPROVAL_MARKER = "<!-- INLINE_APPROVAL:";

/** Max characters for an approval reason string */
export const APPROVAL_REASON_MAX_CHARS = 500;

/** Tools whose output is untrusted external content */
export const UNTRUSTED_TOOL_PREFIXES = [
  "web_search", "web_fetch", "web_extract",
  "builtin.browser_navigate", "builtin.browser_get_content",
  "builtin.browser_get_elements", "builtin.browser_evaluate",
  "builtin.browser_screenshot",
] as const;

/* ── Scheduler Engine ─────────────────────────────────────────────── */

/** Default interval between scheduler engine ticks (ms) */
export const SCHEDULER_POLL_MS = 10_000;

/** Default lease duration when claiming a task-run (seconds) */
export const SCHEDULER_LEASE_SECONDS = 60;

/** Max due schedules fetched per engine tick */
export const SCHEDULER_BATCH_SIZE = 25;

/** Max chars of task response stored for logging */
export const SCHEDULER_RESPONSE_PREVIEW_CHARS = 4_000;

/** Hours after which a run stuck in 'running' state is considered stale and marked 'timeout' */
export const SCHEDULER_STALE_RUN_HOURS = 2;

/* ── File System Tools ────────────────────────────────────────────── */

/** Max file size for a single read operation (2 MB) */
export const FS_MAX_READ_BYTES = 2 * 1024 * 1024;

/** Max captured output from script execution (64 KB) */
export const FS_MAX_SCRIPT_OUTPUT = 64 * 1024;

/** Script execution timeout (ms) */
export const FS_SCRIPT_TIMEOUT_MS = 30_000;

/* ── Network Tools ────────────────────────────────────────────────── */

/** Max captured output from commands (64 KB) */
export const NET_MAX_OUTPUT = 64 * 1024;

/** Command execution timeout (ms) */
export const NET_CMD_TIMEOUT_MS = 30_000;

/** SSH connection timeout (ms) */
export const NET_SSH_TIMEOUT_MS = 60_000;

/** Per-port connect timeout for port scanning (ms) */
export const NET_PORT_SCAN_TIMEOUT_MS = 2_000;

/** HTTP request timeout (ms) */
export const NET_HTTP_TIMEOUT_MS = 30_000;

/** Max HTTP response body captured (128 KB) */
export const NET_MAX_HTTP_BODY = 128 * 1024;

/* ── Custom Tool Sandbox ──────────────────────────────────────────── */

/** Custom tool execution timeout (ms) */
export const SANDBOX_TIMEOUT_MS = 30_000;

/** Dry-run validation timeout for custom tools (ms) */
export const SANDBOX_VALIDATION_TIMEOUT_MS = 5_000;

/* ── Browser Automation ───────────────────────────────────────────── */

/** Default page operation timeout (ms) */
export const BROWSER_DEFAULT_TIMEOUT_MS = 15_000;

/** Page navigation timeout (ms) */
export const BROWSER_NAVIGATION_TIMEOUT_MS = 30_000;

/** Selector wait timeout (ms) */
export const BROWSER_SELECTOR_TIMEOUT_MS = 10_000;

/** Settle delay after page load (ms) */
export const BROWSER_SETTLE_DELAY_MS = 1_500;

/** Default max chars from browser_get_content */
export const BROWSER_MAX_CONTENT_CHARS = 10_000;

/** Initial page text preview for LLM (chars) */
export const BROWSER_PAGE_TEXT_PREVIEW_CHARS = 3_000;

/** Default max elements from browser_get_elements */
export const BROWSER_MAX_ELEMENTS = 30;

/** Default wait timeout for browser_wait_for (ms) */
export const BROWSER_WAIT_TIMEOUT_MS = 10_000;

/* ── LLM Providers ────────────────────────────────────────────────── */

/** Default max response tokens for LLM completions */
export const LLM_MAX_RESPONSE_TOKENS = 4_096;

/** OpenAI client HTTP timeout (ms) — 120 s to accommodate multi-agent orchestrator runs */
export const LLM_CLIENT_TIMEOUT_MS = 120_000;

/** Max retry attempts for LLM API calls */
export const LLM_MAX_RETRIES = 1;

/** Max entries in the embedding vector cache */
export const EMBEDDING_CACHE_MAX_SIZE = 500;

/** Embedding cache entry TTL (ms) — 1 hour */
export const EMBEDDING_CACHE_TTL_MS = 60 * 60 * 1_000;

/* ── Cache TTLs ───────────────────────────────────────────────────── */

/** Default in-memory cache entry TTL (ms) */
export const CACHE_DEFAULT_TTL_MS = 60_000;

/** Auth/user cache TTL (ms) — 5 minutes */
export const CACHE_AUTH_TTL_MS = 300_000;

/* ── Audio (STT/TTS) ──────────────────────────────────────────────── */

/** Default TTS voice */
export const AUDIO_DEFAULT_TTS_VOICE = "nova" as const;

/** Default TTS model */
export const AUDIO_DEFAULT_TTS_MODEL = "tts-1";

/** Default STT model */
export const AUDIO_DEFAULT_STT_MODEL = "whisper-1";

/** Max audio file size for STT (MB) */
export const AUDIO_MAX_SIZE_MB = 25;

/** Max audio file size for STT (bytes) */
export const AUDIO_MAX_SIZE_BYTES = AUDIO_MAX_SIZE_MB * 1024 * 1024;

/** Max text length for TTS (chars) */
export const AUDIO_MAX_TTS_TEXT_LENGTH = 4_096;

/** Audio operation timeout (ms) */
export const AUDIO_OPERATION_TIMEOUT_MS = 60_000;

/* ── Voice Conversation ───────────────────────────────────────────── */

/** Max history messages in voice conversation context */
export const VOICE_MAX_HISTORY_MESSAGES = 30;

/** Max tool iterations for voice conversation turns */
export const VOICE_MAX_TOOL_ITERATIONS = 10;

/** Hard timeout for a voice conversation turn (ms) */
export const VOICE_TURN_TIMEOUT_MS = 60_000;

/* ── MCP ──────────────────────────────────────────────────────────── */

/** Per-server MCP connection timeout (ms) */
export const MCP_CONNECT_TIMEOUT_MS = 15_000;

/* ── Database Pragmas ─────────────────────────────────────────────── */

/** SQLite busy_timeout — wait on lock before SQLITE_BUSY (ms) */
export const DB_BUSY_TIMEOUT_MS = 5_000;

/** SQLite page cache size (negative = KB, positive = pages) */
export const DB_CACHE_SIZE_KB = -64_000;

/** SQLite memory-mapped I/O buffer (bytes) — 256 MB */
export const DB_MMAP_SIZE = 268_435_456;

/* ── Email Transport ──────────────────────────────────────────────── */

/** SMTP connection timeout (ms) */
export const EMAIL_CONNECTION_TIMEOUT_MS = 10_000;

/** SMTP greeting timeout (ms) */
export const EMAIL_GREETING_TIMEOUT_MS = 10_000;

/** SMTP socket read/write timeout (ms) */
export const EMAIL_SOCKET_TIMEOUT_MS = 15_000;

/** IMAP socket timeout (ms) */
export const EMAIL_IMAP_SOCKET_TIMEOUT_MS = 30_000;

/* ── Rate Limiting ────────────────────────────────────────────────── */

/** Sliding window duration for rate limiter (ms) */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Max requests per IP within the sliding window */
export const RATE_LIMIT_MAX_REQUESTS = 120;

/** Max tracked IPs in the rate limiter cache */
export const RATE_LIMIT_CACHE_SIZE = 10_000;

/* ── Azure OpenAI ─────────────────────────────────────────────────── */

/** Default Azure OpenAI API version used as fallback */
export const AZURE_OPENAI_DEFAULT_API_VERSION = "2024-08-01-preview";

/* ── LLM Orchestrator ─────────────────────────────────────────────── */

/** Provider instance cache TTL (ms) */
export const LLM_PROVIDER_CACHE_TTL_MS = 10_000;

/* ── File Generation ──────────────────────────────────────────────── */

/** Default generated image width (px) */
export const FILE_IMAGE_DEFAULT_WIDTH = 1_024;

/** Default generated image height (px) */
export const FILE_IMAGE_DEFAULT_HEIGHT = 576;

/** Min image dimension clamp (px) */
export const FILE_IMAGE_MIN_DIMENSION = 32;

/** Max image dimension clamp (px) */
export const FILE_IMAGE_MAX_DIMENSION = 4_096;

/* ── FS Tools — Chunk Defaults ────────────────────────────────────── */

/** Default byte chunk for fs_read_file (64 KB) */
export const FS_DEFAULT_CHUNK_BYTES = 65_536;

/** Default byte chunk for fs_extract_text (256 KB) */
export const FS_EXTRACT_DEFAULT_BYTES = 262_144;

/** Default max output chars for fs_extract_text */
export const FS_EXTRACT_DEFAULT_MAX_CHARS = 15_000;

/** Hard max output chars for fs_extract_text */
export const FS_EXTRACT_MAX_CHARS_LIMIT = 100_000;

/** Max entries when recursively walking a directory */
export const FS_WALK_DIR_LIMIT = 500;

/* ── Network Tools — Ping ─────────────────────────────────────────── */

/** Default ping packet count */
export const NET_PING_DEFAULT_COUNT = 4;

/** Max ping packet count */
export const NET_PING_MAX_COUNT = 20;

/** Ping-sweep per-host timeout (ms) */
export const NET_PING_SWEEP_TIMEOUT_MS = 3_000;

/** ip-route command timeout (ms) */
export const NET_IP_ROUTE_TIMEOUT_MS = 5_000;

/* ── Knowledge ────────────────────────────────────────────────────── */

/** Max chars of prompt text sent to LLM for knowledge extraction */
export const KNOWLEDGE_PROMPT_MAX_CHARS = 8_000;

/* ── Gatekeeper ───────────────────────────────────────────────────── */

/** Max chars of tool results shown in gatekeeper logs */
export const GATEKEEPER_RESULT_PREVIEW_CHARS = 500;

/* ── SSE / Streaming ──────────────────────────────────────────────── */

/** Log-stream heartbeat interval (ms) */
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

/** Log-stream poll interval (ms) */
export const SSE_LOG_POLL_INTERVAL_MS = 2_000;

/* ── Pagination ───────────────────────────────────────────────────── */

/** Default page size for thread listing */
export const THREADS_DEFAULT_LIMIT = 50;

/** Max page size for thread listing */
export const THREADS_MAX_LIMIT = 200;

/* ── Browser Viewport ─────────────────────────────────────────────── */

/** Default browser viewport width (px) */
export const BROWSER_VIEWPORT_WIDTH = 1_366;

/** Default browser viewport height (px) */
export const BROWSER_VIEWPORT_HEIGHT = 768;
