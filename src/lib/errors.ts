/**
 * Custom error class hierarchy for the Nexus Agent.
 *
 * Provides typed error discrimination via `instanceof` checks,
 * structured context for logging, and HTTP status code mapping
 * for API routes.
 *
 * Categories:
 * - NexusError: base class with code + context
 * - ValidationError: invalid input, missing required fields (400)
 * - ConfigurationError: missing/invalid config, [Nexus] prefix (500)
 * - PermissionError: access denied, blocked operations (403)
 * - NotFoundError: resource/tool not found (404)
 * - IntegrationError: external API failures, timeouts (502)
 */

export class NexusError extends Error {
  /** Machine-readable error code (e.g., "VALIDATION_FAILED", "NOT_CONFIGURED"). */
  readonly code: string;
  /** Suggested HTTP status code for API responses. */
  readonly statusCode: number;
  /** Structured context for logging (no secrets). */
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "NexusError";
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
  }
}

export class ValidationError extends NexusError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "VALIDATION_FAILED", 400, context);
    this.name = "ValidationError";
  }
}

export class ConfigurationError extends NexusError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "NOT_CONFIGURED", 500, context);
    this.name = "ConfigurationError";
  }
}

export class PermissionError extends NexusError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "PERMISSION_DENIED", 403, context);
    this.name = "PermissionError";
  }
}

export class NotFoundError extends NexusError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "NOT_FOUND", 404, context);
    this.name = "NotFoundError";
  }
}

export class IntegrationError extends NexusError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "INTEGRATION_FAILED", 502, context);
    this.name = "IntegrationError";
  }
}

/**
 * Map a NexusError to an HTTP status code.
 * Falls back to 500 for unknown error types.
 */
export function getHttpStatusFromError(err: unknown): number {
  if (err instanceof NexusError) return err.statusCode;
  return 500;
}

/**
 * Type guard for NexusError instances.
 */
export function isNexusError(err: unknown): err is NexusError {
  return err instanceof NexusError;
}

/**
 * Returns true if the error is an HTTP 429 rate-limit response from either
 * the OpenAI SDK (openai.RateLimitError) or the Anthropic SDK
 * (Anthropic.RateLimitError), or any error whose message clearly indicates
 * rate limiting.
 */
export function isRateLimitError(err: unknown): boolean {
  if (err == null) return false;
  // Both SDKs expose a numeric `status` property on API errors
  if (typeof (err as Record<string, unknown>).status === "number") {
    return (err as { status: number }).status === 429;
  }
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("rate limit") || msg.includes("rate_limit") || msg.includes("too many requests");
}

/**
 * Returns true if the error is an authentication/authorization failure (HTTP
 * 401 or 403) from either the OpenAI or Anthropic SDK.  Auth errors should
 * short-circuit the provider fallback loop — trying other providers with the
 * same credentials is unlikely to succeed.
 */
export function isAuthError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof (err as Record<string, unknown>).status === "number") {
    const s = (err as { status: number }).status;
    return s === 401 || s === 403;
  }
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("invalid api key") ||
    msg.includes("authentication") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden")
  );
}
