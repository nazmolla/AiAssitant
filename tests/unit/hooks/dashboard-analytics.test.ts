/**
 * Unit tests for dashboard-analytics pure functions.
 */

import {
  levelColor,
  sourceColor,
  parseMetadata,
  formatMetaValue,
  extractSessionKey,
  inferOutcome,
  inferTopic,
  toPct,
} from "@/lib/dashboard-analytics";

describe("dashboard-analytics helpers", () => {
  describe("levelColor", () => {
    test("returns error for critical/error", () => {
      expect(levelColor("critical")).toBe("error");
      expect(levelColor("error")).toBe("error");
    });
    test("returns warning for warning", () => {
      expect(levelColor("warning")).toBe("warning");
    });
    test("returns default for verbose", () => {
      expect(levelColor("verbose")).toBe("default");
    });
    test("returns info for unknown levels", () => {
      expect(levelColor("debug")).toBe("info");
    });
  });

  describe("sourceColor", () => {
    test("returns correct classes for known sources", () => {
      expect(sourceColor("agent")).toBe("text-blue-400");
      expect(sourceColor("scheduler")).toBe("text-purple-400");
      expect(sourceColor("mcp")).toBe("text-green-400");
      expect(sourceColor("hitl")).toBe("text-yellow-400");
    });
    test("returns default for null/unknown", () => {
      expect(sourceColor(null)).toBe("text-muted-foreground");
      expect(sourceColor("other")).toBe("text-muted-foreground");
    });
  });

  describe("parseMetadata", () => {
    test("returns null for null/empty input", () => {
      expect(parseMetadata(null)).toBeNull();
      expect(parseMetadata("")).toBeNull();
    });
    test("parses valid JSON object", () => {
      expect(parseMetadata('{"key": "value"}')).toEqual({ key: "value" });
    });
    test("wraps non-object JSON in value key", () => {
      expect(parseMetadata('"hello"')).toEqual({ value: "hello" });
      expect(parseMetadata("[1,2,3]")).toEqual({ value: [1, 2, 3] });
    });
    test("returns raw wrapper for invalid JSON", () => {
      expect(parseMetadata("not json")).toEqual({ raw: "not json" });
    });
  });

  describe("formatMetaValue", () => {
    test("handles null/undefined", () => {
      expect(formatMetaValue(null)).toBe("—");
      expect(formatMetaValue(undefined)).toBe("—");
    });
    test("handles primitives", () => {
      expect(formatMetaValue("hello")).toBe("hello");
      expect(formatMetaValue(42)).toBe("42");
      expect(formatMetaValue(true)).toBe("Yes");
      expect(formatMetaValue(false)).toBe("No");
    });
    test("JSON-stringifies objects", () => {
      expect(formatMetaValue({ a: 1 })).toContain('"a": 1');
    });
  });

  describe("extractSessionKey", () => {
    test("returns null for null/empty/non-object", () => {
      expect(extractSessionKey(null)).toBeNull();
      expect(extractSessionKey("")).toBeNull();
      expect(extractSessionKey('"string"')).toBeNull();
    });
    test("extracts known session keys", () => {
      expect(extractSessionKey('{"sessionId": "s1"}')).toBe("s1");
      expect(extractSessionKey('{"threadId": "t1"}')).toBe("t1");
      expect(extractSessionKey('{"run_id": "r1"}')).toBe("r1");
    });
    test("extracts numeric session keys", () => {
      expect(extractSessionKey('{"sessionId": 42}')).toBe("42");
    });
    test("returns null when no matching keys", () => {
      expect(extractSessionKey('{"foo": "bar"}')).toBeNull();
    });
  });

  describe("inferOutcome", () => {
    test("infers abandoned", () => {
      expect(inferOutcome([{ id: 1, level: "verbose", source: null, message: "user abandoned", metadata: null, created_at: "" }])).toBe("abandoned");
    });
    test("infers escalated", () => {
      expect(inferOutcome([{ id: 1, level: "error", source: null, message: "escalated to human", metadata: null, created_at: "" }])).toBe("escalated");
    });
    test("infers resolved", () => {
      expect(inferOutcome([{ id: 1, level: "verbose", source: null, message: "task completed successfully", metadata: null, created_at: "" }])).toBe("resolved");
    });
    test("defaults to open", () => {
      expect(inferOutcome([{ id: 1, level: "verbose", source: null, message: "processing", metadata: null, created_at: "" }])).toBe("open");
    });
  });

  describe("inferTopic", () => {
    test("infers Payment", () => {
      expect(inferTopic([{ id: 1, level: "verbose", source: null, message: "billing issue", metadata: null, created_at: "" }])).toBe("Payment");
    });
    test("infers Device", () => {
      expect(inferTopic([{ id: 1, level: "verbose", source: null, message: "smarthome device offline", metadata: null, created_at: "" }])).toBe("Device");
    });
    test("defaults to General", () => {
      expect(inferTopic([{ id: 1, level: "verbose", source: null, message: "hello world", metadata: null, created_at: "" }])).toBe("General");
    });
  });

  describe("toPct", () => {
    test("rounds to integer percentage", () => {
      expect(toPct(75.6)).toBe("76%");
      expect(toPct(0)).toBe("0%");
      expect(toPct(100)).toBe("100%");
    });
  });
});
