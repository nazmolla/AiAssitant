/**
 * Integration tests — Phone channel webhook
 */
import { installAuthMocks } from "../../helpers/mock-auth";
installAuthMocks();

jest.mock("@/lib/agent", () => ({
  runAgentLoop: jest.fn(async () => ({
    content: "Hello from phone conversation",
    toolsUsed: [],
    attachments: [],
  })),
}));

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { createChannel, getChannel } from "@/lib/db";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/channels/[channelId]/webhook/route";

let userId: string;
let channelId: string;
let webhookSecret: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "phone-webhook@test.com", role: "user" });
  const created = createChannel({
    label: "Phone Calls",
    channelType: "phone",
    configJson: JSON.stringify({ provider: "twilio", voiceName: "alice" }),
    userId,
  });
  channelId = created.id;
  const hydrated = getChannel(channelId);
  webhookSecret = hydrated?.webhook_secret || "";
});

afterAll(() => teardownTestDb());

describe("POST /api/channels/[channelId]/webhook (phone)", () => {
  test("returns TwiML response for phone speech input", async () => {
    const body = new URLSearchParams({
      SpeechResult: "turn on living room lights",
      From: "+15550001111",
      CallSid: "CA123",
    }).toString();

    const req = new NextRequest(
      `http://localhost/api/channels/${channelId}/webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-webhook-secret": webhookSecret,
        },
        body,
      },
    );

    const res = await POST(req, { params: Promise.resolve({ channelId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");

    const xml = await res.text();
    expect(xml).toContain("<Response>");
    expect(xml).toContain("<Say");
    expect(xml).toContain("Hello from phone conversation");
    expect(xml).toContain("<Gather");
  });
});
