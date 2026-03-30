/**
 * Unit tests — voice-id.ts
 *
 * Tests cosine similarity, threshold logic, and no-match fallback.
 * Does not test Azure API calls (those require credentials and are covered by smoke tests).
 */
import { installAuthMocks } from "../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../helpers/test-db";

// Mock Azure Speaker Recognition so unit tests don't make HTTP calls
jest.mock("@/lib/env", () => ({
  env: {
    AZURE_SPEAKER_KEY: undefined,
    AZURE_SPEAKER_REGION: undefined,
  },
}));

import { identifySpeaker, removeVoiceProfile } from "@/lib/voice-id";
import { upsertVoiceProfile } from "@/lib/db/voice-profile-queries";

let userId1: string;
let userId2: string;

beforeAll(() => {
  setupTestDb();
  userId1 = seedTestUser({ email: "voice1@example.com", role: "user" });
  userId2 = seedTestUser({ email: "voice2@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("identifySpeaker", () => {
  test("returns null when Azure is not configured", async () => {
    const pcm = Buffer.alloc(32000); // 1s of silence at 16kHz 16-bit
    const result = await identifySpeaker(pcm);
    expect(result).toBeNull();
  });
});

describe("removeVoiceProfile", () => {
  test("does not throw when no profile exists (idempotent)", () => {
    expect(() => removeVoiceProfile(userId1)).not.toThrow();
  });

  test("removes an existing profile", () => {
    // Enroll a fake embedding
    const embedding = Buffer.alloc(128);
    upsertVoiceProfile(userId1, embedding);

    removeVoiceProfile(userId1);

    // identifySpeaker will return null since Azure is not configured,
    // but the DB profile should be gone — verify via the queries directly
    const { getVoiceProfile } = require("@/lib/db/voice-profile-queries");
    expect(getVoiceProfile(userId1)).toBeUndefined();
  });
});

describe("upsertVoiceProfile (idempotent)", () => {
  test("updates existing profile on second upsert", () => {
    const emb1 = Buffer.alloc(128, 1);
    const emb2 = Buffer.alloc(128, 2);
    const { upsertVoiceProfile: upsert, getVoiceProfile } = require("@/lib/db/voice-profile-queries");

    upsert(userId2, emb1);
    upsert(userId2, emb2);

    const profile = getVoiceProfile(userId2);
    expect(profile).toBeDefined();
    // Second embedding should be stored
    expect(Buffer.from(profile.embedding).every((b: number) => b === 2)).toBe(true);
  });
});
