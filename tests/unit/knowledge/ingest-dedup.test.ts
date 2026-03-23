/**
 * Unit tests — Knowledge ingestion embedding deduplication (closes #253)
 *
 * Validates that `generateEmbedding` is NOT called when a knowledge entry
 * already has an embedding, preventing redundant subscription API calls.
 */

// ── Mock generateEmbedding ────────────────────────────────────

const mockGenerateEmbedding = jest.fn().mockResolvedValue([0.1, 0.2, 0.3]);
jest.mock("@/lib/llm/embeddings", () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}));

// ── Mock LLM chat provider (returns one known fact) ──────────

const KNOWN_FACT = JSON.stringify([
  { entity: "Alice", attribute: "preference", value: "dark mode" },
]);
jest.mock("@/lib/llm", () => ({
  createChatProvider: () => ({
    chat: jest.fn().mockResolvedValue({ content: KNOWN_FACT, toolCalls: [], finishReason: "stop" }),
  }),
}));

// ── Use real DB (test DB) for hasKnowledgeEmbedding checks ───

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  upsertKnowledge,
  upsertKnowledgeEmbedding,
  hasKnowledgeEmbedding,
} from "@/lib/db/queries";
import { ingestKnowledgeFromText } from "@/lib/knowledge";

// Suppress addLog calls that hit the DB
jest.mock("@/lib/db/log-queries", () => ({ addLog: jest.fn() }));
jest.mock("@/lib/logging/logger", () => ({
  createLogger: () => ({
    enter: jest.fn(), exit: jest.fn(), error: jest.fn(),
    warning: jest.fn(), info: jest.fn(), warn: jest.fn(),
  }),
}));

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "ingest-dedup@test.com" });
});
afterAll(() => teardownTestDb());
beforeEach(() => {
  jest.clearAllMocks();
  mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
});

describe("ingestKnowledgeFromText — embedding deduplication (#253)", () => {
  test("calls generateEmbedding for a new fact (no existing embedding)", async () => {
    await ingestKnowledgeFromText({
      source: "chat:test-new",
      text: "Alice prefers dark mode",
      userId,
    });

    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
  });

  test("does NOT call generateEmbedding when embedding already exists", async () => {
    // Pre-insert the fact and its embedding so the ingestor finds it
    const knowledgeId = upsertKnowledge(
      { user_id: userId, entity: "Alice", attribute: "preference", value: "dark mode", source_context: "pre-existing" },
      userId
    );
    upsertKnowledgeEmbedding(knowledgeId, [0.9, 0.8, 0.7]);
    expect(hasKnowledgeEmbedding(knowledgeId)).toBe(true);

    // Ingest same fact again — LLM mock returns the same entity/attribute/value
    await ingestKnowledgeFromText({
      source: "chat:test-dedup",
      text: "Alice prefers dark mode",
      userId,
    });

    // generateEmbedding must NOT have been called
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });
});
