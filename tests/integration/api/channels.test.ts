/**
 * Integration tests — Channels Config API (/api/config/channels)
 *
 * Tests CRUD operations, validation, and secret masking.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

// Mock Discord bot — prevent real bot connections
jest.mock("@/lib/channels/discord", () => ({
  startDiscordBot: jest.fn(async () => {}),
  stopDiscordBot: jest.fn(async () => {}),
  isDiscordBotActive: jest.fn(() => false),
}));

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/config/channels/route";

let userId: string;
let otherUserId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "ch-user@test.com", role: "user" });
  otherUserId = seedTestUser({ email: "ch-other@test.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/config/channels", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns empty list for new user", async () => {
    setMockUser({ id: userId, email: "ch-user@test.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });
});

describe("POST /api/config/channels", () => {
  test("returns 400 without required fields", async () => {
    setMockUser({ id: userId, email: "ch-user@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/channels", {
      method: "POST",
      body: JSON.stringify({ label: "Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid channel type", async () => {
    setMockUser({ id: userId, email: "ch-user@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/channels", {
      method: "POST",
      body: JSON.stringify({
        label: "Test",
        channelType: "invalid_type",
        config: { key: "value" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("channelType");
  });

  test("returns 400 for overly long label", async () => {
    setMockUser({ id: userId, email: "ch-user@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/channels", {
      method: "POST",
      body: JSON.stringify({
        label: "x".repeat(101),
        channelType: "slack",
        config: { token: "tok" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("creates a slack channel", async () => {
    setMockUser({ id: userId, email: "ch-user@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/channels", {
      method: "POST",
      body: JSON.stringify({
        label: "My Slack",
        channelType: "slack",
        config: { bot_token: "xoxb-secret-token", channel: "#general" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.label).toBe("My Slack");
    expect(data.channel_type).toBe("slack");
  });

  test("created channel appears in GET list with secrets masked", async () => {
    setMockUser({ id: userId, email: "ch-user@test.com", role: "user" });
    const res = await GET();
    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);
    const slack = data.find((ch: any) => ch.label === "My Slack");
    expect(slack).toBeDefined();
    // Config should have secrets masked
    const config = JSON.parse(slack.config_json);
    expect(config.bot_token).toBe("••••••");
  });

  test("other user cannot see another user's channels", async () => {
    setMockUser({ id: otherUserId, email: "ch-other@test.com", role: "user" });
    const res = await GET();
    const data = await res.json();
    expect(data).toEqual([]);
  });
});
