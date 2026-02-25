/**
 * Unit tests — User Profiles
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { getUserProfile, upsertUserProfile } from "@/lib/db/queries";

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "profile@example.com" });
});
afterAll(() => teardownTestDb());

describe("User Profiles", () => {
  test("getUserProfile returns undefined before creation", () => {
    expect(getUserProfile(userId)).toBeUndefined();
  });

  test("upsertUserProfile creates a new profile", () => {
    const profile = upsertUserProfile(userId, {
      display_name: "Mohamed",
      title: "Developer",
      bio: "Building AI agents",
      location: "Dubai",
      skills: JSON.stringify(["TypeScript", "Python"]),
    });
    expect(profile.display_name).toBe("Mohamed");
    expect(profile.title).toBe("Developer");
    expect(profile.bio).toBe("Building AI agents");
    expect(profile.location).toBe("Dubai");
  });

  test("upsertUserProfile updates existing profile", () => {
    const profile = upsertUserProfile(userId, {
      title: "Senior Developer",
    });
    expect(profile.title).toBe("Senior Developer");
    // Other fields should be preserved
    expect(profile.display_name).toBe("Mohamed");
    expect(profile.bio).toBe("Building AI agents");
  });

  test("upsertUserProfile handles all social links", () => {
    const profile = upsertUserProfile(userId, {
      linkedin: "https://linkedin.com/in/test",
      github: "https://github.com/test",
      twitter: "https://twitter.com/test",
      website: "https://example.com",
    });
    expect(profile.linkedin).toBe("https://linkedin.com/in/test");
    expect(profile.github).toBe("https://github.com/test");
    expect(profile.twitter).toBe("https://twitter.com/test");
    expect(profile.website).toBe("https://example.com");
  });

  test("upsertUserProfile handles screen_sharing_enabled toggle", () => {
    let profile = upsertUserProfile(userId, { screen_sharing_enabled: 0 });
    expect(profile.screen_sharing_enabled).toBe(0);
    profile = upsertUserProfile(userId, { screen_sharing_enabled: 1 });
    expect(profile.screen_sharing_enabled).toBe(1);
  });

  test("profile defaults to empty strings and empty JSON arrays", () => {
    const newUser = seedTestUser({ email: "defaults@example.com" });
    const profile = upsertUserProfile(newUser, {});
    expect(profile.display_name).toBe("");
    expect(profile.skills).toBe("[]");
    expect(profile.languages).toBe("[]");
    expect(profile.phone).toBe("");
  });
});
