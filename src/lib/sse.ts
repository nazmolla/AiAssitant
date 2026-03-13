/**
 * Reusable SSE (Server-Sent Events) stream factory.
 *
 * Eliminates duplicated SSE setup across API routes by providing a
 * single `createSSEStream()` that returns a `Response`-ready
 * `ReadableStream`, a guarded `send()` function, and a `close()` handle.
 */

const SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export interface SSEStream {
  /** The ReadableStream to pass to `new Response(stream, ...)`. */
  stream: ReadableStream<Uint8Array>;
  /** Safely enqueue text to the stream. No-ops after cancel/close. */
  send: (text: string) => void;
  /** Close the stream from the server side. Safe to call multiple times. */
  close: () => void;
  /** Whether the client has disconnected or the stream was closed. */
  isCancelled: () => boolean;
}

/**
 * Create an SSE stream with built-in disconnect detection.
 *
 * Sends an SSE comment (`: stream opened\n\n`) immediately to flush
 * HTTP headers and prevent proxy buffering.
 */
export function createSSEStream(): SSEStream {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;

  const send = (text: string): void => {
    if (cancelled) return;
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      cancelled = true;
    }
  };

  const close = (): void => {
    if (cancelled) return;
    cancelled = true;
    try {
      controller.close();
    } catch {
      /* already closed */
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      send(": stream opened\n\n");
    },
    cancel() {
      cancelled = true;
    },
  });

  return { stream, send, close, isCancelled: () => cancelled };
}

/**
 * Build a `Response` from an `SSEStream`.
 *
 * Convenience wrapper around `new Response(stream, { headers })`.
 */
export function sseResponse(sse: SSEStream): Response {
  return new Response(sse.stream, { headers: SSE_HEADERS });
}

/** Format a named SSE event. */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
