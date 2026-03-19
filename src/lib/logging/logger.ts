/**
 * Structured Logger Utility — Nexus Agent
 *
 * Provides scoped, trace-correlated logging suitable for Azure App Insights,
 * Google Analytics, or any OTLP-compatible observability backend.
 *
 * Design:
 * - createLogger(source)  → ScopedLogger bound to a source module
 * - newTrace(source)      → ScopedLogger with a fresh top-level trace ID
 * - logger.child(source?) → child span sharing the parent trace ID
 * - logger.enter(fn, params) / logger.exit(fn, result, durationMs)
 *     emit structured verbose logs for function entry/exit with full context
 * - logger.thought(msg)   → stores log as source="thought" for dashboard Thoughts view
 * - All calls ultimately delegate to addLog(), which respects the global log_level_min setting
 *
 * Trace anatomy:
 *   traceId       — top-level identifier for an end-to-end request/run
 *   spanId        — identifier for a unit of work within the trace
 *   parentSpanId  — links child spans to their parent
 *   correlationId — human-readable cross-system ID (e.g. threadId, runId)
 */

import { addLog } from "@/lib/db/log-queries";
import crypto from "crypto";

// ── Trace Context ─────────────────────────────────────────────────

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  correlationId?: string;
}

function newSpanId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function newTraceId(): string {
  return crypto.randomUUID();
}

// ── Scoped Logger Interface ───────────────────────────────────────

export interface ScopedLogger {
  readonly source: string;
  readonly traceCtx: TraceContext;

  /** Low-level verbose log — filtered by server log_level_min */
  verbose(msg: string, meta?: Record<string, unknown>): void;

  /** Informational event — alias for verbose at DB level, displayed as "info" in metadata */
  info(msg: string, meta?: Record<string, unknown>): void;

  /** Warning — always stored, triggers in-app notification */
  warning(msg: string, meta?: Record<string, unknown>): void;

  /** Error with optional Error object — stack trace auto-captured */
  error(msg: string, meta?: Record<string, unknown>, err?: unknown): void;

  /** Critical failure — always stored and notified */
  critical(msg: string, meta?: Record<string, unknown>, err?: unknown): void;

  /**
   * Agent chain-of-thought log.
   * Stored as level="verbose" with source="thought" so the dashboard
   * Thoughts filter can show them regardless of log_level_min.
   */
  thought(msg: string, meta?: Record<string, unknown>): void;

  /**
   * Log function entry.
   * Emits: verbose "→ fnName" with { fn, in: params, traceId, spanId }
   */
  enter(fn: string, params?: Record<string, unknown>): void;

  /**
   * Log function exit.
   * Emits: verbose "← fnName (Xms)" with { fn, out: result, durationMs, traceId, spanId }
   */
  exit(fn: string, result?: unknown, durationMs?: number): void;

  /**
   * Create a child logger that shares the parent traceId but gets a new spanId.
   * Use this when crossing a sub-system boundary (e.g. agent → tool executor).
   */
  child(source?: string): ScopedLogger;

  /**
   * Return a new logger with the given correlationId attached to all metadata.
   */
  withCorrelation(correlationId: string): ScopedLogger;
}

// ── Logger Implementation ─────────────────────────────────────────

class Logger implements ScopedLogger {
  readonly source: string;
  readonly traceCtx: TraceContext;

  constructor(source: string, traceCtx?: Partial<TraceContext>) {
    this.source = source;
    this.traceCtx = {
      traceId: traceCtx?.traceId ?? newTraceId(),
      spanId: traceCtx?.spanId ?? newSpanId(),
      parentSpanId: traceCtx?.parentSpanId,
      correlationId: traceCtx?.correlationId,
    };
  }

  private buildMeta(extra?: Record<string, unknown>): string {
    const base: Record<string, unknown> = {
      traceId: this.traceCtx.traceId,
      spanId: this.traceCtx.spanId,
    };
    if (this.traceCtx.parentSpanId) base.parentSpanId = this.traceCtx.parentSpanId;
    if (this.traceCtx.correlationId) base.correlationId = this.traceCtx.correlationId;
    return JSON.stringify({ ...base, ...extra });
  }

  private emit(level: string, msg: string, metadata: string): void {
    try {
      addLog({ level, source: this.source, message: msg, metadata });
    } catch {
      // Silently swallow — logging must never crash the application or break tests
    }
  }

  verbose(msg: string, meta?: Record<string, unknown>): void {
    this.emit("verbose", msg, this.buildMeta(meta));
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    // "info" normalizes to "verbose" in DB; tag it explicitly so log viewers can filter
    this.emit("info", msg, this.buildMeta({ ...meta, logLevel: "info" }));
  }

  warning(msg: string, meta?: Record<string, unknown>): void {
    this.emit("warning", msg, this.buildMeta(meta));
  }

  error(msg: string, meta?: Record<string, unknown>, err?: unknown): void {
    const errMeta = err
      ? { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }
      : undefined;
    this.emit("error", msg, this.buildMeta({ ...meta, ...errMeta }));
  }

  critical(msg: string, meta?: Record<string, unknown>, err?: unknown): void {
    const errMeta = err
      ? { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }
      : undefined;
    this.emit("critical", msg, this.buildMeta({ ...meta, ...errMeta }));
  }

  thought(msg: string, meta?: Record<string, unknown>): void {
    // Stored as level="verbose" + source="thought" — dashboard Thoughts tab filters by source
    try {
      addLog({ level: "thought", source: "thought", message: msg, metadata: this.buildMeta(meta) });
    } catch {
      // Silently swallow
    }
  }

  enter(fn: string, params?: Record<string, unknown>): void {
    this.emit("verbose", `→ ${fn}`, this.buildMeta({ fn, in: params }));
  }

  exit(fn: string, result?: unknown, durationMs?: number): void {
    const extra: Record<string, unknown> = { fn };
    if (result !== undefined) extra.out = result;
    if (durationMs !== undefined) extra.durationMs = durationMs;
    this.emit(
      "verbose",
      durationMs !== undefined ? `← ${fn} (${durationMs}ms)` : `← ${fn}`,
      this.buildMeta(extra)
    );
  }

  child(source?: string): ScopedLogger {
    return new Logger(source ?? this.source, {
      traceId: this.traceCtx.traceId,
      spanId: newSpanId(),
      parentSpanId: this.traceCtx.spanId,
      correlationId: this.traceCtx.correlationId,
    });
  }

  withCorrelation(correlationId: string): ScopedLogger {
    return new Logger(this.source, { ...this.traceCtx, correlationId });
  }
}

// ── Public Factory Functions ──────────────────────────────────────

/**
 * Create a scoped logger for a module/source with an optional pre-set trace context.
 * The same traceId should be threaded across subsystems by passing logger.child()
 * or logger.withCorrelation() rather than creating fresh loggers.
 */
export function createLogger(source: string, traceCtx?: Partial<TraceContext>): ScopedLogger {
  return new Logger(source, traceCtx);
}

/**
 * Create a logger with a fresh top-level trace ID.
 * Call this at the start of a new top-level operation (e.g. an agent run, a scheduler tick).
 */
export function newTrace(source: string): ScopedLogger {
  return new Logger(source);
}

/**
 * Wrap an async function with automatic entry/exit logging including duration.
 * Returns the function result unchanged.
 *
 * @example
 * const result = await traced(log, "myFn", { userId }, () => doWork(userId));
 */
export async function traced<T>(
  log: ScopedLogger,
  fn: string,
  params: Record<string, unknown> | undefined,
  work: () => Promise<T>,
): Promise<T> {
  log.enter(fn, params);
  const t0 = Date.now();
  try {
    const result = await work();
    log.exit(fn, undefined, Date.now() - t0);
    return result;
  } catch (err) {
    log.error(`${fn} threw`, { fn, durationMs: Date.now() - t0 }, err);
    throw err;
  }
}
