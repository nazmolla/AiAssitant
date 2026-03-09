/**
 * Unit tests — Pagination for listing queries (PERF-08)
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  createThread,
  listThreadsPaginated,
  listKnowledgePaginated,
  upsertKnowledge,
} from "@/lib/db/queries";

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "pagination@example.com" });
});
afterAll(() => teardownTestDb());

describe("listThreadsPaginated", () => {
  beforeAll(() => {
    // Create 15 threads for pagination tests
    for (let i = 0; i < 15; i++) {
      createThread(`Thread ${String(i).padStart(2, "0")}`, userId);
    }
  });

  test("returns paginated result with correct shape", () => {
    const result = listThreadsPaginated(userId, 10, 0);
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("limit");
    expect(result).toHaveProperty("offset");
    expect(result).toHaveProperty("hasMore");
    expect(Array.isArray(result.data)).toBe(true);
  });

  test("respects limit parameter", () => {
    const result = listThreadsPaginated(userId, 5, 0);
    expect(result.data.length).toBe(5);
    expect(result.limit).toBe(5);
  });

  test("respects offset parameter", () => {
    const page1 = listThreadsPaginated(userId, 5, 0);
    const page2 = listThreadsPaginated(userId, 5, 5);
    expect(page1.data[0].id).not.toBe(page2.data[0].id);
    expect(page2.offset).toBe(5);
  });

  test("hasMore is true when more results exist", () => {
    const result = listThreadsPaginated(userId, 5, 0);
    expect(result.hasMore).toBe(true);
    expect(result.total).toBeGreaterThan(5);
  });

  test("hasMore is false on last page", () => {
    const result = listThreadsPaginated(userId, 100, 0);
    expect(result.hasMore).toBe(false);
    expect(result.data.length).toBe(result.total);
  });

  test("total count is consistent across pages", () => {
    const page1 = listThreadsPaginated(userId, 5, 0);
    const page2 = listThreadsPaginated(userId, 5, 5);
    expect(page1.total).toBe(page2.total);
  });

  test("default limit is 50", () => {
    const result = listThreadsPaginated(userId);
    expect(result.limit).toBe(50);
  });

  test("excludes proactive-scan, scheduled, and channel threads", () => {
    createThread("[proactive-scan] test", userId, { threadType: "proactive" });
    createThread("[scheduled] test", userId, { threadType: "scheduled" });
    createThread("channel:test:test", userId, { threadType: "channel", channelId: "test", externalSenderId: "test" });
    const result = listThreadsPaginated(userId, 200, 0);
    expect(result.data.every((t) => t.thread_type === "interactive")).toBe(true);
  });

  test("offset beyond total returns empty data", () => {
    const result = listThreadsPaginated(userId, 50, 9999);
    expect(result.data.length).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.total).toBeGreaterThan(0);
  });
});

describe("listKnowledgePaginated", () => {
  beforeAll(() => {
    // Create 25 knowledge entries for pagination tests
    for (let i = 0; i < 25; i++) {
      upsertKnowledge({
        user_id: userId,
        entity: `Entity ${i}`,
        attribute: `attr_${i}`,
        value: `Value ${i}`,
        source_type: "manual",
        source_context: null,
      }, userId);
    }
  });

  test("returns paginated result with correct shape", () => {
    const result = listKnowledgePaginated(userId, 10, 0);
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("limit");
    expect(result).toHaveProperty("offset");
    expect(result).toHaveProperty("hasMore");
    expect(Array.isArray(result.data)).toBe(true);
  });

  test("respects limit and offset", () => {
    const page1 = listKnowledgePaginated(userId, 10, 0);
    const page2 = listKnowledgePaginated(userId, 10, 10);
    expect(page1.data.length).toBe(10);
    expect(page2.data.length).toBe(10);
    expect(page1.data[0].id).not.toBe(page2.data[0].id);
  });

  test("hasMore is correct", () => {
    const small = listKnowledgePaginated(userId, 5, 0);
    expect(small.hasMore).toBe(true);

    const all = listKnowledgePaginated(userId, 500, 0);
    expect(all.hasMore).toBe(false);
  });

  test("default limit is 100", () => {
    const result = listKnowledgePaginated(userId);
    expect(result.limit).toBe(100);
  });

  test("total count is accurate", () => {
    const result = listKnowledgePaginated(userId, 1, 0);
    expect(result.total).toBe(25);
  });
});

describe("API response format verification (source code)", () => {
  const fs = require("fs");
  const path = require("path");

  test("threads route uses listThreadsPaginated", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../../src/app/api/threads/route.ts"),
      "utf-8"
    );
    expect(src).toContain("listThreadsPaginated");
    expect(src).toContain("limit");
    expect(src).toContain("offset");
  });

  test("knowledge route uses listKnowledgePaginated", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../../src/app/api/knowledge/route.ts"),
      "utf-8"
    );
    expect(src).toContain("listKnowledgePaginated");
    expect(src).toContain("limit");
    expect(src).toContain("offset");
  });

  test("smoke test checks paginated format", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../../scripts/smoke-test.js"),
      "utf-8"
    );
    expect(src).toContain("listRes.body.data");
  });
});
