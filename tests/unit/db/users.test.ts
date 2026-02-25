/**
 * Unit tests — Database query functions (users)
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  getUserById,
  getUserByEmail,
  createUser,
  listUsers,
  getUserCount,
  updateUserRole,
  updateUserEnabled,
  isUserEnabled,
  deleteUser,
  updateUserPermissions,
  getUserPermissions,
  listUsersWithPermissions,
} from "@/lib/db/queries";

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
