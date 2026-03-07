/**
 * Unit tests — Message list virtualization (PERF-13)
 *
 * Verifies that chat-area.tsx uses @tanstack/react-virtual for windowed
 * rendering of messages instead of a flat .map().
 */

import fs from "fs";
import path from "path";

const chatAreaSrc = fs.readFileSync(
  path.join(__dirname, "../../../src/components/chat-area.tsx"),
  "utf-8",
);

describe("Message list virtualization", () => {
  test("imports useVirtualizer from @tanstack/react-virtual", () => {
    expect(chatAreaSrc).toContain('import { useVirtualizer } from "@tanstack/react-virtual"');
  });

  test("creates a virtualizer with dynamic measurement", () => {
    expect(chatAreaSrc).toContain("useVirtualizer({");
    expect(chatAreaSrc).toContain("estimateSize:");
    expect(chatAreaSrc).toContain("measureElement:");
    expect(chatAreaSrc).toContain("getScrollElement:");
  });

  test("renders only virtual items (windowed), not all messages", () => {
    expect(chatAreaSrc).toContain("getVirtualItems()");
    expect(chatAreaSrc).toContain("virtualItem.start");
    expect(chatAreaSrc).toContain("virtualItem.index");
  });

  test("uses overscan buffer for smooth scrolling", () => {
    expect(chatAreaSrc).toContain("overscan:");
  });

  test("uses absolute positioning for virtual items", () => {
    expect(chatAreaSrc).toContain("position: \"absolute\"");
    expect(chatAreaSrc).toContain("translateY(");
    expect(chatAreaSrc).toContain("getTotalSize()");
  });

  test("auto-scrolls to bottom on new messages via scrollToIndex", () => {
    expect(chatAreaSrc).toContain("scrollToIndex");
    expect(chatAreaSrc).toContain('align: "end"');
  });

  test("re-measures items when streaming content changes", () => {
    expect(chatAreaSrc).toContain("virtualizer.measure()");
  });

  test("does NOT use a flat .map() directly on processedMessages for rendering", () => {
    // The old pattern: processedMessages.map((...) => (\n  <Box\n    key={msg.id}
    // The new pattern wraps it in virtualizer.getVirtualItems().map(...)
    // Ensure there's no direct processedMessages.map rendering
    const flatMapPattern = /processedMessages\.map\(.*=>\s*\(\s*<Box/s;
    expect(chatAreaSrc).not.toMatch(flatMapPattern);
  });

  test("scroll container has a ref for the virtualizer", () => {
    expect(chatAreaSrc).toContain("scrollContainerRef");
    expect(chatAreaSrc).toContain("ref={scrollContainerRef}");
  });

  test("uses measureRef callback for dynamic height measurement", () => {
    expect(chatAreaSrc).toContain("measureRef");
    expect(chatAreaSrc).toContain("ref={measureRef}");
    expect(chatAreaSrc).toContain("data-index={virtualItem.index}");
  });
});
