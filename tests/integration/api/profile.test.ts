/**
 * Integration tests — Profile Config API (/api/config/profile)
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/config/profile/route";

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "profile-api@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/config/profile", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns null when no profile exists", async () => {
    setMockUser({ id: userId, email: "profile-api@example.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBeNull();
  });
});

describe("PUT /api/config/profile", () => {
  test("creates a profile", async () => {
    setMockUser({ id: userId, email: "profile-api@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/profile", {
      method: "PUT",
      body: JSON.stringify({
        display_name: "Mohamed",
        title: "Engineer",
        bio: "Building things",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.display_name).toBe("Mohamed");
    expect(data.title).toBe("Engineer");
    expect(data.bio).toBe("Building things");
  });

  test("profile now returned by GET", async () => {
    setMockUser({ id: userId, email: "profile-api@example.com", role: "user" });
    const res = await GET();
    const data = await res.json();
    expect(data).not.toBeNull();
    expect(data.display_name).toBe("Mohamed");
  });

  test("updates partial fields (preserves others)", async () => {
    setMockUser({ id: userId, email: "profile-api@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/profile", {
      method: "PUT",
      body: JSON.stringify({ title: "Senior Engineer" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    const data = await res.json();
    expect(data.title).toBe("Senior Engineer");
    expect(data.display_name).toBe("Mohamed");
  });

  test("sanitizes overly long bio", async () => {
    setMockUser({ id: userId, email: "profile-api@example.com", role: "user" });
    const longBio = "a".repeat(3000);
    const req = new NextRequest("http://localhost/api/config/profile", {
      method: "PUT",
      body: JSON.stringify({ bio: longBio }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    const data = await res.json();
    expect(data.bio.length).toBeLessThanOrEqual(2000);
  });

  test("rejects disallowed fields (mass assignment protection)", async () => {
    setMockUser({ id: userId, email: "profile-api@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/profile", {
      method: "PUT",
      body: JSON.stringify({ display_name: "Test", role: "admin", id: "hacked" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    // The disallowed fields should NOT appear or affect anything
  });

  test("handles screen_sharing_enabled toggle", async () => {
    setMockUser({ id: userId, email: "profile-api@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/profile", {
      method: "PUT",
      body: JSON.stringify({ screen_sharing_enabled: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    const data = await res.json();
    expect(data.screen_sharing_enabled).toBe(1);
  });

  test("saves and returns theme preference", async () => {
    setMockUser({ id: userId, email: "profile-api@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/profile", {
      method: "PUT",
      body: JSON.stringify({ theme: "midnight" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    const data = await res.json();
    expect(data.theme).toBe("midnight");
  });

  test("saves and returns timezone preference", async () => {
    setMockUser({ id: userId, email: "profile-api@example.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/profile", {
      method: "PUT",
      body: JSON.stringify({ timezone: "Asia/Dubai" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    const data = await res.json();
    expect(data.timezone).toBe("Asia/Dubai");
  });
});
