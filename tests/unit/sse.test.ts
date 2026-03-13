import { createSSEStream, sseResponse, sseEvent } from "@/lib/sse";

describe("SSE helpers", () => {
  /* ── sseEvent ────────────────────────────────────────────────────── */

  describe("sseEvent", () => {
    it("formats a named SSE event with JSON data", () => {
      const result = sseEvent("token", "hello");
      expect(result).toBe('event: token\ndata: "hello"\n\n');
    });

    it("serializes object data as JSON", () => {
      const result = sseEvent("done", { content: "hi" });
      expect(result).toBe('event: done\ndata: {"content":"hi"}\n\n');
    });

    it("handles null data", () => {
      const result = sseEvent("ping", null);
      expect(result).toBe("event: ping\ndata: null\n\n");
    });
  });

  /* ── createSSEStream ─────────────────────────────────────────────── */

  describe("createSSEStream", () => {
    it("returns stream, send, close, and isCancelled", () => {
      const sse = createSSEStream();
      expect(sse.stream).toBeInstanceOf(ReadableStream);
      expect(typeof sse.send).toBe("function");
      expect(typeof sse.close).toBe("function");
      expect(typeof sse.isCancelled).toBe("function");
    });

    it("starts with isCancelled = false", () => {
      const sse = createSSEStream();
      expect(sse.isCancelled()).toBe(false);
      // consume the stream so the test doesn't hang
      sse.close();
    });

    it("isCancelled returns true after close()", () => {
      const sse = createSSEStream();
      sse.close();
      expect(sse.isCancelled()).toBe(true);
    });

    it("close() is safe to call multiple times", () => {
      const sse = createSSEStream();
      sse.close();
      expect(() => sse.close()).not.toThrow();
    });

    it("send() flushes initial comment and data to the stream", async () => {
      const sse = createSSEStream();
      sse.send(sseEvent("msg", "hi"));
      sse.close();

      const reader = sse.stream.getReader();
      const chunks: string[] = [];
      const decoder = new TextDecoder();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
      }

      const full = chunks.join("");
      expect(full).toContain(": stream opened\n\n");
      expect(full).toContain('event: msg\ndata: "hi"\n\n');
    });

    it("send() no-ops after close()", () => {
      const sse = createSSEStream();
      sse.close();
      // should not throw
      expect(() => sse.send("should be ignored")).not.toThrow();
    });
  });

  /* ── sseResponse ─────────────────────────────────────────────────── */

  describe("sseResponse", () => {
    it("returns a Response with correct SSE headers", () => {
      const sse = createSSEStream();
      const res = sseResponse(sse);
      sse.close();

      expect(res).toBeInstanceOf(Response);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
      expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    });
  });
});
