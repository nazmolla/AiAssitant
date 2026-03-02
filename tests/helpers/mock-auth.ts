/**
 * Shared helper for integration tests — mocks the auth guard
 * so route handlers get a consistent authenticated user.
 */
import type { AuthenticatedUser } from "@/lib/auth/guard";
import { NextResponse } from "next/server";

let mockUser: AuthenticatedUser | null = null;

/**
 * Set the user that `requireUser` / `requireAdmin` will return.
 * Pass `null` to simulate unauthenticated requests.
 */
export function setMockUser(user: AuthenticatedUser | null): void {
  mockUser = user;
}

/**
 * Install mocks for `@/lib/auth/guard` and `@/lib/auth` modules.
 * Call this **before** importing any route module.
 */
export function installAuthMocks(): void {
  jest.mock("@/lib/auth/guard", () => ({
    requireUser: jest.fn(async () => {
      if (!mockUser) {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
      }
      return { user: mockUser };
    }),
    requireAdmin: jest.fn(async () => {
      if (!mockUser) {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
      }
      if (mockUser.apiKeyScopes) {
        return { error: NextResponse.json({ error: "Admin endpoints require session authentication, not API keys." }, { status: 403 }) };
      }
      if (mockUser.role !== "admin") {
        return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
      }
      return { user: mockUser };
    }),
    getAuthenticatedUser: jest.fn(async () => mockUser),
  }));

  // The barrel re-export module
  jest.mock("@/lib/auth", () => ({
    requireUser: jest.fn(async () => {
      if (!mockUser) {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
      }
      return { user: mockUser };
    }),
    requireAdmin: jest.fn(async () => {
      if (!mockUser) {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
      }
      if (mockUser.apiKeyScopes) {
        return { error: NextResponse.json({ error: "Admin endpoints require session authentication, not API keys." }, { status: 403 }) };
      }
      if (mockUser.role !== "admin") {
        return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
      }
      return { user: mockUser };
    }),
    getAuthenticatedUser: jest.fn(async () => mockUser),
    authOptions: {},
  }));

  // Stub bootstrap so it doesn't try to connect real services
  jest.mock("@/lib/bootstrap", () => ({
    bootstrapRuntime: jest.fn(async () => {}),
  }));
}
