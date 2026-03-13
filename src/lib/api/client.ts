/**
 * Frontend API Client
 *
 * Centralized fetch wrapper for all frontend API calls.
 * Handles:
 *  - Base URL resolution (relative paths)
 *  - JSON request/response serialization
 *  - Error parsing and typed ApiError throwing
 *  - Auth is implicit via Next.js session cookies
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {}, signal } = opts;

  const fetchOpts: RequestInit = { method, signal };

  if (body !== undefined) {
    fetchOpts.body = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }

  if (Object.keys(headers).length > 0) {
    fetchOpts.headers = headers;
  }

  const res = await fetch(url, fetchOpts);

  if (!res.ok) {
    let errorBody: unknown;
    try {
      errorBody = await res.json();
    } catch {
      errorBody = await res.text().catch(() => null);
    }
    const msg = (errorBody && typeof errorBody === "object" && "error" in errorBody)
      ? String((errorBody as Record<string, unknown>).error)
      : `Request failed with status ${res.status}`;
    throw new ApiError(msg, res.status, errorBody);
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(url: string, signal?: AbortSignal) =>
    request<T>(url, { signal }),

  post: <T>(url: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(url, { method: "POST", body, signal }),

  put: <T>(url: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(url, { method: "PUT", body, signal }),

  patch: <T>(url: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(url, { method: "PATCH", body, signal }),

  delete: <T>(url: string, signal?: AbortSignal) =>
    request<T>(url, { method: "DELETE", signal }),
};
