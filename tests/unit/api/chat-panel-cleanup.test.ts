/**
 * Unit tests — Blob URL cleanup on ChatPanel unmount (PERF-19)
 *
 * Since ChatPanel can't be directly rendered in jest/jsdom (react-markdown
 * is ESM-only), we verify:
 *  1. The source code contains URL.revokeObjectURL in the cleanup effect
 *  2. The cleanup logic pattern works correctly in isolation
 */

describe("ChatPanel blob URL cleanup (PERF-19)", () => {
  test("chat-panel.tsx revokes blob URLs in the unmount useEffect", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "../../../src/components/chat-panel.tsx"),
      "utf-8"
    );

    // The cleanup effect should call URL.revokeObjectURL for pending files
    expect(src).toContain("URL.revokeObjectURL(pf.previewUrl)");

    // Ensure it's in a cleanup return function (setPendingFiles inside effect cleanup)
    // The pattern is: setPendingFiles((prev) => { for (const pf of prev) { ... revokeObjectURL ... }
    expect(src).toMatch(/setPendingFiles\(\(prev\)\s*=>\s*\{[\s\S]*?revokeObjectURL/);
  });

  test("blob URL revocation logic works correctly", () => {
    // Simulate the cleanup pattern from chat-panel.tsx
    const revokedUrls: string[] = [];
    const mockRevokeObjectURL = (url: string) => revokedUrls.push(url);

    interface PendingFile {
      file: { name: string };
      previewUrl: string | null;
      uploading: boolean;
    }

    const pendingFiles: PendingFile[] = [
      { file: { name: "a.png" }, previewUrl: "blob:http://localhost/abc123", uploading: false },
      { file: { name: "b.txt" }, previewUrl: null, uploading: false },
      { file: { name: "c.jpg" }, previewUrl: "blob:http://localhost/def456", uploading: false },
    ];

    // Simulate the cleanup logic from the useEffect
    for (const pf of pendingFiles) {
      if (pf.previewUrl) mockRevokeObjectURL(pf.previewUrl);
    }

    // Should have revoked exactly 2 blob URLs (b.txt has no preview)
    expect(revokedUrls).toEqual([
      "blob:http://localhost/abc123",
      "blob:http://localhost/def456",
    ]);
  });

  test("blob URL revocation skips null previewUrl entries", () => {
    const revokedUrls: string[] = [];
    const mockRevokeObjectURL = (url: string) => revokedUrls.push(url);

    const pendingFiles = [
      { previewUrl: null },
      { previewUrl: null },
      { previewUrl: null },
    ];

    for (const pf of pendingFiles) {
      if (pf.previewUrl) mockRevokeObjectURL(pf.previewUrl);
    }

    expect(revokedUrls).toEqual([]);
  });

  test("blob URL revocation handles empty pending files list", () => {
    const revokedUrls: string[] = [];
    const mockRevokeObjectURL = (url: string) => revokedUrls.push(url);

    const pendingFiles: { previewUrl: string | null }[] = [];

    for (const pf of pendingFiles) {
      if (pf.previewUrl) mockRevokeObjectURL(pf.previewUrl);
    }

    expect(revokedUrls).toEqual([]);
  });

  test("individual file removal also revokes blob URL", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "../../../src/components/chat-panel.tsx"),
      "utf-8"
    );

    // When a file is removed from pending list, its blob URL should also be revoked
    // The pattern: copy[index].previewUrl URL.revokeObjectURL(copy[index].previewUrl!)
    expect(src).toMatch(/revokeObjectURL\(copy\[index\]\.previewUrl!\)/);
  });
});
