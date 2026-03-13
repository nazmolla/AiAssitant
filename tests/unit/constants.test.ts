/**
 * Unit tests for src/lib/constants.ts
 *
 * Verifies that all centralized constants:
 *  - Have expected default values (regression check)
 *  - Are properly exported and importable
 *  - Consuming modules reference the same constant (no duplicates)
 */

import {
  // Agent loop
  MAX_TOOL_ITERATIONS,
  TOOL_RESULT_TRUNCATION_LIMIT,
  INLINE_APPROVAL_MARKER,
  APPROVAL_REASON_MAX_CHARS,
  UNTRUSTED_TOOL_PREFIXES,

  // Scheduler
  SCHEDULER_POLL_MS,
  SCHEDULER_LEASE_SECONDS,
  SCHEDULER_BATCH_SIZE,
  SCHEDULER_RESPONSE_PREVIEW_CHARS,

  // FS tools
  FS_MAX_READ_BYTES,
  FS_MAX_SCRIPT_OUTPUT,
  FS_SCRIPT_TIMEOUT_MS,

  // Network tools
  NET_MAX_OUTPUT,
  NET_CMD_TIMEOUT_MS,
  NET_SSH_TIMEOUT_MS,
  NET_PORT_SCAN_TIMEOUT_MS,
  NET_HTTP_TIMEOUT_MS,
  NET_MAX_HTTP_BODY,

  // Custom tool sandbox
  SANDBOX_TIMEOUT_MS,
  SANDBOX_VALIDATION_TIMEOUT_MS,

  // Browser
  BROWSER_DEFAULT_TIMEOUT_MS,
  BROWSER_NAVIGATION_TIMEOUT_MS,
  BROWSER_SELECTOR_TIMEOUT_MS,
  BROWSER_SETTLE_DELAY_MS,
  BROWSER_MAX_CONTENT_CHARS,
  BROWSER_PAGE_TEXT_PREVIEW_CHARS,
  BROWSER_MAX_ELEMENTS,
  BROWSER_WAIT_TIMEOUT_MS,

  // LLM
  LLM_MAX_RESPONSE_TOKENS,
  LLM_CLIENT_TIMEOUT_MS,
  LLM_MAX_RETRIES,
  EMBEDDING_CACHE_MAX_SIZE,
  EMBEDDING_CACHE_TTL_MS,

  // Cache
  CACHE_DEFAULT_TTL_MS,
  CACHE_AUTH_TTL_MS,

  // Audio
  AUDIO_DEFAULT_TTS_VOICE,
  AUDIO_DEFAULT_TTS_MODEL,
  AUDIO_DEFAULT_STT_MODEL,
  AUDIO_MAX_SIZE_MB,
  AUDIO_MAX_SIZE_BYTES,
  AUDIO_MAX_TTS_TEXT_LENGTH,
  AUDIO_OPERATION_TIMEOUT_MS,

  // Voice conversation
  VOICE_MAX_HISTORY_MESSAGES,
  VOICE_MAX_TOOL_ITERATIONS,
  VOICE_TURN_TIMEOUT_MS,

  // MCP
  MCP_CONNECT_TIMEOUT_MS,
} from "@/lib/constants";

describe("constants", () => {
  describe("Agent loop constants", () => {
    test("MAX_TOOL_ITERATIONS is 25", () => {
      expect(MAX_TOOL_ITERATIONS).toBe(25);
    });

    test("TOOL_RESULT_TRUNCATION_LIMIT is 15000", () => {
      expect(TOOL_RESULT_TRUNCATION_LIMIT).toBe(15_000);
    });

    test("INLINE_APPROVAL_MARKER is the HTML comment prefix", () => {
      expect(INLINE_APPROVAL_MARKER).toBe("<!-- INLINE_APPROVAL:");
    });

    test("APPROVAL_REASON_MAX_CHARS is 500", () => {
      expect(APPROVAL_REASON_MAX_CHARS).toBe(500);
    });

    test("UNTRUSTED_TOOL_PREFIXES contains expected tool names", () => {
      expect(UNTRUSTED_TOOL_PREFIXES).toContain("web_search");
      expect(UNTRUSTED_TOOL_PREFIXES).toContain("builtin.browser_navigate");
      expect(UNTRUSTED_TOOL_PREFIXES.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe("Scheduler constants", () => {
    test("SCHEDULER_POLL_MS is 10 seconds", () => {
      expect(SCHEDULER_POLL_MS).toBe(10_000);
    });

    test("SCHEDULER_LEASE_SECONDS is 60", () => {
      expect(SCHEDULER_LEASE_SECONDS).toBe(60);
    });

    test("SCHEDULER_BATCH_SIZE is 25", () => {
      expect(SCHEDULER_BATCH_SIZE).toBe(25);
    });

    test("SCHEDULER_RESPONSE_PREVIEW_CHARS is 4000", () => {
      expect(SCHEDULER_RESPONSE_PREVIEW_CHARS).toBe(4_000);
    });
  });

  describe("Tool execution constants", () => {
    test("FS_MAX_READ_BYTES is 2 MB", () => {
      expect(FS_MAX_READ_BYTES).toBe(2 * 1024 * 1024);
    });

    test("FS_MAX_SCRIPT_OUTPUT is 64 KB", () => {
      expect(FS_MAX_SCRIPT_OUTPUT).toBe(64 * 1024);
    });

    test("FS_SCRIPT_TIMEOUT_MS is 30 seconds", () => {
      expect(FS_SCRIPT_TIMEOUT_MS).toBe(30_000);
    });

    test("NET_MAX_OUTPUT is 64 KB", () => {
      expect(NET_MAX_OUTPUT).toBe(64 * 1024);
    });

    test("NET_SSH_TIMEOUT_MS is 60 seconds", () => {
      expect(NET_SSH_TIMEOUT_MS).toBe(60_000);
    });

    test("NET_MAX_HTTP_BODY is 128 KB", () => {
      expect(NET_MAX_HTTP_BODY).toBe(128 * 1024);
    });
  });

  describe("Sandbox constants", () => {
    test("SANDBOX_TIMEOUT_MS is 30 seconds", () => {
      expect(SANDBOX_TIMEOUT_MS).toBe(30_000);
    });

    test("SANDBOX_VALIDATION_TIMEOUT_MS is 5 seconds", () => {
      expect(SANDBOX_VALIDATION_TIMEOUT_MS).toBe(5_000);
    });
  });

  describe("Browser constants", () => {
    test("BROWSER_DEFAULT_TIMEOUT_MS is 15 seconds", () => {
      expect(BROWSER_DEFAULT_TIMEOUT_MS).toBe(15_000);
    });

    test("BROWSER_NAVIGATION_TIMEOUT_MS is 30 seconds", () => {
      expect(BROWSER_NAVIGATION_TIMEOUT_MS).toBe(30_000);
    });

    test("BROWSER_PAGE_TEXT_PREVIEW_CHARS is 3000", () => {
      expect(BROWSER_PAGE_TEXT_PREVIEW_CHARS).toBe(3_000);
    });

    test("BROWSER_MAX_ELEMENTS is 30", () => {
      expect(BROWSER_MAX_ELEMENTS).toBe(30);
    });
  });

  describe("LLM constants", () => {
    test("LLM_MAX_RESPONSE_TOKENS is 4096", () => {
      expect(LLM_MAX_RESPONSE_TOKENS).toBe(4_096);
    });

    test("LLM_CLIENT_TIMEOUT_MS is 15 seconds", () => {
      expect(LLM_CLIENT_TIMEOUT_MS).toBe(15_000);
    });

    test("LLM_MAX_RETRIES is 1", () => {
      expect(LLM_MAX_RETRIES).toBe(1);
    });

    test("EMBEDDING_CACHE_MAX_SIZE is 500", () => {
      expect(EMBEDDING_CACHE_MAX_SIZE).toBe(500);
    });

    test("EMBEDDING_CACHE_TTL_MS is 1 hour", () => {
      expect(EMBEDDING_CACHE_TTL_MS).toBe(3_600_000);
    });
  });

  describe("Cache constants", () => {
    test("CACHE_DEFAULT_TTL_MS is 60 seconds", () => {
      expect(CACHE_DEFAULT_TTL_MS).toBe(60_000);
    });

    test("CACHE_AUTH_TTL_MS is 5 minutes", () => {
      expect(CACHE_AUTH_TTL_MS).toBe(300_000);
    });
  });

  describe("Audio constants", () => {
    test("AUDIO_DEFAULT_TTS_VOICE is nova", () => {
      expect(AUDIO_DEFAULT_TTS_VOICE).toBe("nova");
    });

    test("AUDIO_MAX_SIZE_BYTES matches MB value", () => {
      expect(AUDIO_MAX_SIZE_BYTES).toBe(AUDIO_MAX_SIZE_MB * 1024 * 1024);
    });

    test("AUDIO_MAX_TTS_TEXT_LENGTH is 4096", () => {
      expect(AUDIO_MAX_TTS_TEXT_LENGTH).toBe(4_096);
    });
  });

  describe("Voice conversation constants", () => {
    test("VOICE_MAX_HISTORY_MESSAGES is 30", () => {
      expect(VOICE_MAX_HISTORY_MESSAGES).toBe(30);
    });

    test("VOICE_MAX_TOOL_ITERATIONS is 10", () => {
      expect(VOICE_MAX_TOOL_ITERATIONS).toBe(10);
    });

    test("VOICE_TURN_TIMEOUT_MS is 60 seconds", () => {
      expect(VOICE_TURN_TIMEOUT_MS).toBe(60_000);
    });
  });

  describe("MCP constants", () => {
    test("MCP_CONNECT_TIMEOUT_MS is 15 seconds", () => {
      expect(MCP_CONNECT_TIMEOUT_MS).toBe(15_000);
    });
  });

  describe("Duplicate consolidation", () => {
    test("system-prompt re-exports same MAX_TOOL_ITERATIONS", async () => {
      const sp = await import("@/lib/agent/system-prompt");
      expect(sp.MAX_TOOL_ITERATIONS).toBe(MAX_TOOL_ITERATIONS);
    });

    test("system-prompt re-exports same UNTRUSTED_TOOL_PREFIXES", async () => {
      const sp = await import("@/lib/agent/system-prompt");
      expect(sp.UNTRUSTED_TOOL_PREFIXES).toBe(UNTRUSTED_TOOL_PREFIXES);
    });

    test("approval-handler re-exports same INLINE_APPROVAL_MARKER", async () => {
      const ah = await import("@/lib/agent/approval-handler");
      expect(ah.INLINE_APPROVAL_MARKER).toBe(INLINE_APPROVAL_MARKER);
    });
  });
});
