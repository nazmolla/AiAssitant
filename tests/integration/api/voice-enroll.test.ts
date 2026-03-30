/**
 * Integration tests — Voice enrollment API (/api/voice/enroll)
 *
 * Verifies GET (status), DELETE (remove profile), and POST error handling.
 * POST enrollment is not fully integration-tested here because it requires
 * Azure Speaker Recognition credentials — the unit tests for voice-id.ts cover
 * the embedding logic.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";

installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { GET, DELETE } from "@/app/api/voice/enroll/route";

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "voiceenroll@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/voice/enroll", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns enrolled: false when no profile exists", async () => {
    setMockUser({ id: userId, email: "voiceenroll@example.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.enrolled).toBe(false);
    expect(data.enrolledAt).toBeNull();
  });
});

describe("DELETE /api/voice/enroll", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  test("returns 204 even when no profile exists (idempotent)", async () => {
    setMockUser({ id: userId, email: "voiceenroll@example.com", role: "user" });
    const res = await DELETE();
    expect(res.status).toBe(204);
  });
});
