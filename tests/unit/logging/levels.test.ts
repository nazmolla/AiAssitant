/**
 * Unit tests — Logging level utilities
 *
 * Validates:
 * - normalizeLogLevel() maps all aliases correctly
 * - isUnifiedLogLevel() type guard accuracy
 * - shouldKeepLog() level comparison logic
 */

import { normalizeLogLevel, isUnifiedLogLevel, shouldKeepLog } from "@/lib/logging/levels";

describe("normalizeLogLevel", () => {
  test.each([
    ["critical", "critical"],
    ["fatal", "critical"],
    ["panic", "critical"],
    ["error", "error"],
    ["err", "error"],
    ["warning", "warning"],
    ["warn", "warning"],
    ["verbose", "verbose"],
    ["info", "verbose"],
    ["debug", "verbose"],
    ["trace", "verbose"],
    ["thought", "verbose"],
  ])("maps %s → %s", (input, expected) => {
    expect(normalizeLogLevel(input)).toBe(expected);
  });

  test("handles uppercase and mixed case", () => {
    expect(normalizeLogLevel("CRITICAL")).toBe("critical");
    expect(normalizeLogLevel("Warning")).toBe("warning");
    expect(normalizeLogLevel("  Error  ")).toBe("error");
  });

  test("defaults to verbose for unknown values", () => {
    expect(normalizeLogLevel("garbage")).toBe("verbose");
    expect(normalizeLogLevel("")).toBe("verbose");
    expect(normalizeLogLevel(null)).toBe("verbose");
    expect(normalizeLogLevel(undefined)).toBe("verbose");
  });
});

describe("isUnifiedLogLevel", () => {
  test("returns true for valid unified levels", () => {
    expect(isUnifiedLogLevel("verbose")).toBe(true);
    expect(isUnifiedLogLevel("warning")).toBe(true);
    expect(isUnifiedLogLevel("error")).toBe(true);
    expect(isUnifiedLogLevel("critical")).toBe(true);
  });

  test("returns false for aliases and invalid values", () => {
    expect(isUnifiedLogLevel("info")).toBe(false);
    expect(isUnifiedLogLevel("debug")).toBe(false);
    expect(isUnifiedLogLevel("warn")).toBe(false);
    expect(isUnifiedLogLevel("fatal")).toBe(false);
    expect(isUnifiedLogLevel(null)).toBe(false);
    expect(isUnifiedLogLevel(undefined)).toBe(false);
    expect(isUnifiedLogLevel("")).toBe(false);
  });
});

describe("shouldKeepLog", () => {
  test("keeps logs at or above the minimum level", () => {
    expect(shouldKeepLog("critical", "verbose")).toBe(true);
    expect(shouldKeepLog("error", "verbose")).toBe(true);
    expect(shouldKeepLog("warning", "verbose")).toBe(true);
    expect(shouldKeepLog("verbose", "verbose")).toBe(true);
  });

  test("discards logs below the minimum level", () => {
    expect(shouldKeepLog("verbose", "warning")).toBe(false);
    expect(shouldKeepLog("verbose", "error")).toBe(false);
    expect(shouldKeepLog("verbose", "critical")).toBe(false);
    expect(shouldKeepLog("warning", "error")).toBe(false);
    expect(shouldKeepLog("warning", "critical")).toBe(false);
    expect(shouldKeepLog("error", "critical")).toBe(false);
  });

  test("same level always passes", () => {
    expect(shouldKeepLog("critical", "critical")).toBe(true);
    expect(shouldKeepLog("error", "error")).toBe(true);
    expect(shouldKeepLog("warning", "warning")).toBe(true);
    expect(shouldKeepLog("verbose", "verbose")).toBe(true);
  });
});
