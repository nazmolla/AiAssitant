"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ fontFamily: "monospace", padding: 32, background: "#111", color: "#eee" }}>
        <h1 style={{ color: "#f44" }}>Unhandled Error</h1>
        <pre style={{ whiteSpace: "pre-wrap", background: "#222", padding: 16, borderRadius: 8, fontSize: 14 }}>
          {error.message}
        </pre>
        <pre style={{ whiteSpace: "pre-wrap", color: "#888", fontSize: 12 }}>
          {error.stack}
        </pre>
        <button onClick={() => reset()} style={{ marginTop: 16, padding: "8px 24px", fontSize: 16, cursor: "pointer" }}>
          Retry
        </button>
      </body>
    </html>
  );
}
