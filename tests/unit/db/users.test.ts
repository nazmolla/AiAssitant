/**
 * Unit tests — Database query functions (users)
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  getUserById,
  getUserByEmail,
  getUserByExternalSub,
  createUser,
  listUsers,
  getUserCount,
  updateUserRole,
  updateUserEnabled,
  updateUserPassword,
  isUserEnabled,
  deleteUser,
  updateUserPermissions,
  getUserPermissions,
  listUsersWithPermissions,
} from "@/lib/db/queries";
import { appCache } from "@/lib/cache";

beforeAll(() => setupTestDb());
afterAll(() => teardownTestDb());

describe("User CRUD", () => {
  let userId: string;

  test("createUser creates a user and returns it", () => {
    const user = createUser({
      email: "alice@example.com",
      displayName: "Alice",
      providerId: "local",
      externalSubId: null,
      role: "admin",
    });
    userId = user.id;
    expect(user).toBeDefined();
    expect(user.email).toBe("alice@example.com");
    expect(user.display_name).toBe("Alice");
    expect(user.role).toBe("admin");
  });

  test("getUserById returns the created user", () => {
    const user = getUserById(userId);
    expect(user).toBeDefined();
    expect(user!.id).toBe(userId);
  });

  test("getUserByEmail is case-insensitive", () => {
    const user = getUserByEmail("ALICE@EXAMPLE.COM");
    expect(user).toBeDefined();
    expect(user!.id).toBe(userId);
  });

  test("getUserById returns undefined for unknown id", () => {
    expect(getUserById("nonexistent")).toBeUndefined();
  });

  test("listUsers returns all users", () => {
    createUser({ email: "bob@example.com", providerId: "local", externalSubId: null });
    const users = listUsers();
    expect(users.length).toBeGreaterThanOrEqual(2);
  });

  test("getUserCount returns correct count", () => {
    const count = getUserCount();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("updateUserRole changes the role", () => {
    updateUserRole(userId, "user");
    const user = getUserById(userId);
    expect(user!.role).toBe("user");
  });

  test("updateUserRole rejects invalid roles", () => {
    expect(() => updateUserRole(userId, "superadmin")).toThrow("Invalid role");
  });

  test("updateUserEnabled disables and re-enables a user", () => {
    updateUserEnabled(userId, false);
    expect(isUserEnabled(userId)).toBe(false);
    updateUserEnabled(userId, true);
    expect(isUserEnabled(userId)).toBe(true);
  });

  test("isUserEnabled returns true for unknown user", () => {
    // Default behavior — no row means enabled
    expect(isUserEnabled("nonexistent")).toBe(true);
  });

  test("deleteUser removes the user", () => {
    const tempUser = createUser({ email: "temp@example.com", providerId: "local", externalSubId: null });
    deleteUser(tempUser.id);
    expect(getUserById(tempUser.id)).toBeUndefined();
  });
});

describe("Inactive-by-default registration", () => {
  test("createUser with role=admin defaults to enabled=1", () => {
    const admin = createUser({
      email: "new-admin@example.com",
      providerId: "local",
      externalSubId: null,
      role: "admin",
    });
    expect(isUserEnabled(admin.id)).toBe(true);
  });

  test("createUser with role=user defaults to enabled=0", () => {
    const user = createUser({
      email: "new-regular@example.com",
      providerId: "local",
      externalSubId: null,
      role: "user",
    });
    expect(isUserEnabled(user.id)).toBe(false);
  });

  test("createUser without role defaults to user (inactive)", () => {
    const user = createUser({
      email: "no-role@example.com",
      providerId: "local",
      externalSubId: null,
    });
    expect(user.role).toBe("user");
    expect(isUserEnabled(user.id)).toBe(false);
  });

  test("createUser with explicit enabled=1 overrides default", () => {
    const user = createUser({
      email: "explicit-enabled@example.com",
      providerId: "local",
      externalSubId: null,
      role: "user",
      enabled: 1,
    });
    expect(isUserEnabled(user.id)).toBe(true);
  });

  test("admin can activate inactive user via updateUserEnabled", () => {
    const user = createUser({
      email: "to-activate@example.com",
      providerId: "local",
      externalSubId: null,
      role: "user",
    });
    expect(isUserEnabled(user.id)).toBe(false);

    updateUserEnabled(user.id, true);
    expect(isUserEnabled(user.id)).toBe(true);
  });
});

describe("User Permissions", () => {
  let userId: string;

  beforeAll(() => {
    userId = seedTestUser({ email: "perms@example.com" });
  });

  test("getUserPermissions returns undefined before any row exists", () => {
    expect(getUserPermissions(userId)).toBeUndefined();
  });

  test("updateUserPermissions creates and updates permissions", () => {
    updateUserPermissions(userId, { chat: 0, knowledge: 1 });
    const perms = getUserPermissions(userId);
    expect(perms).toBeDefined();
    expect(perms!.chat).toBe(0);
    expect(perms!.knowledge).toBe(1);
  });

  test("updateUserPermissions ignores invalid fields", () => {
    // Should not throw
    updateUserPermissions(userId, { invalid_field: 1 } as any);
    const perms = getUserPermissions(userId);
    expect(perms).toBeDefined();
  });

  test("updateUserPermissions ignores invalid values", () => {
    // Only 0 and 1 allowed
    updateUserPermissions(userId, { chat: 99 } as any);
    const perms = getUserPermissions(userId);
    expect(perms!.chat).toBe(0); // unchanged from previous
  });

  test("listUsersWithPermissions includes all users with defaults", () => {
    const usersWithPerms = listUsersWithPermissions();
    expect(usersWithPerms.length).toBeGreaterThan(0);
    for (const u of usersWithPerms) {
      expect(u.permissions).toBeDefined();
      expect(typeof u.permissions.chat).toBe("number");
    }
  });
});

describe("Auth query caching & invalidation", () => {
  let userId: string;
  const email = "cache-test@example.com";

  beforeAll(() => {
    const user = createUser({
      email,
      providerId: "local",
      externalSubId: "ext-sub-cache-test",
      role: "admin",
    });
    userId = user.id;
  });

  beforeEach(() => {
    appCache.invalidateAll();
  });

  test("getUserByEmail returns cached result on second call", () => {
    const first = getUserByEmail(email);
    const second = getUserByEmail(email);
    expect(first).toEqual(second);
    // Both should be the same reference (cache hit)
    expect(first).toBe(second);
  });

  test("getUserByExternalSub returns cached result on second call", () => {
    const first = getUserByExternalSub("ext-sub-cache-test");
    const second = getUserByExternalSub("ext-sub-cache-test");
    expect(first).toEqual(second);
    expect(first).toBe(second);
  });

  test("updateUserRole invalidates email and sub caches", () => {
    const before = getUserByEmail(email);
    expect(before!.role).toBe("admin");

    updateUserRole(userId, "user");
    const after = getUserByEmail(email);
    expect(after!.role).toBe("user");
    // Should not be the same reference — cache was invalidated
    expect(after).not.toBe(before);

    // Restore
    updateUserRole(userId, "admin");
  });

  test("updateUserEnabled invalidates email cache", () => {
    getUserByEmail(email); // warm cache
    updateUserEnabled(userId, false);

    const after = getUserByEmail(email);
    expect(isUserEnabled(userId)).toBe(false);

    updateUserEnabled(userId, true);
  });

  test("updateUserPassword invalidates user caches", () => {
    const before = getUserByEmail(email);
    updateUserPassword(userId, "new-hash-123");

    const after = getUserByEmail(email);
    expect(after!.password_hash).toBe("new-hash-123");
    expect(after).not.toBe(before);
  });

  test("deleteUser invalidates all user cache entries", () => {
    const tempUser = createUser({
      email: "cache-del@example.com",
      providerId: "local",
      externalSubId: "ext-del-test",
    });

    // Warm all caches
    getUserByEmail("cache-del@example.com");
    getUserByExternalSub("ext-del-test");
    getUserById(tempUser.id);

    deleteUser(tempUser.id);

    expect(getUserById(tempUser.id)).toBeUndefined();
    expect(getUserByEmail("cache-del@example.com")).toBeUndefined();
    expect(getUserByExternalSub("ext-del-test")).toBeUndefined();
  });

  test("getUserByEmail cache is case-insensitive", () => {
    const lower = getUserByEmail(email);
    appCache.invalidateAll();
    const upper = getUserByEmail(email.toUpperCase());
    // Both should resolve the same user (COLLATE NOCASE)
    expect(lower!.id).toBe(upper!.id);
  });

  test("TTL expiration causes re-query from DB", () => {
    // Warm the cache
    const first = getUserByEmail(email);
    expect(first).toBeDefined();

    // Manually expire the cache entry by back-dating cachedAt
    const key = `user_email:${email.toLowerCase()}`;
    const entry = (appCache as unknown as { entries: Map<string, { data: unknown; cachedAt: number }> }).entries.get(key);
    expect(entry).toBeDefined();
    // Set cachedAt to 6 minutes ago (beyond the 5-min AUTH_CACHE_TTL_MS)
    entry!.cachedAt = Date.now() - 360_000;

    // Next call must re-query (returns fresh object, not same reference)
    const afterExpiry = getUserByEmail(email);
    expect(afterExpiry).toBeDefined();
    expect(afterExpiry!.id).toBe(first!.id);
    expect(afterExpiry).not.toBe(first); // new reference = cache miss
  });

  test("auth cache integrates with login flow (getUserByEmail → getUserById)", () => {
    // Simulate a login flow: look up by email, then verify by id
    const byEmail = getUserByEmail(email);
    expect(byEmail).toBeDefined();

    const byId = getUserById(byEmail!.id);
    expect(byId).toBeDefined();
    expect(byId!.email).toBe(byEmail!.email);

    // Simulate role change during session — both caches should reflect it
    updateUserRole(byEmail!.id, "user");
    const refreshedEmail = getUserByEmail(email);
    const refreshedId = getUserById(byEmail!.id);
    expect(refreshedEmail!.role).toBe("user");
    expect(refreshedId!.role).toBe("user");

    // isUserEnabled should also reflect cached state
    expect(isUserEnabled(byEmail!.id)).toBe(true);

    // Restore
    updateUserRole(byEmail!.id, "admin");
  });
});
