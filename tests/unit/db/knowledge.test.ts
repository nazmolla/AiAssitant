/**
 * Unit tests — Knowledge CRUD & search
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  upsertKnowledge,
  listKnowledge,
  getKnowledgeEntry,
  searchKnowledge,
  updateKnowledge,
  deleteKnowledge,
  upsertKnowledgeEmbedding,
  listKnowledgeEmbeddings,
  getKnowledgeEntriesByIds,
} from "@/lib/db/queries";

let userA: string;
let userB: string;

beforeAll(() => {
  setupTestDb();
  userA = seedTestUser({ email: "kn-a@example.com" });
  userB = seedTestUser({ email: "kn-b@example.com" });
});
afterAll(() => teardownTestDb());

describe("Knowledge CRUD", () => {
  let entryId: number;

  test("upsertKnowledge inserts a new entry", () => {
    entryId = upsertKnowledge(
      { user_id: userA, entity: "Alice", attribute: "email", value: "alice@corp.com", source_context: "chat" },
      userA
    );
    expect(entryId).toBeGreaterThan(0);
  });

  test("getKnowledgeEntry returns the entry", () => {
    const entry = getKnowledgeEntry(entryId);
    expect(entry).toBeDefined();
    expect(entry!.entity).toBe("Alice");
    expect(entry!.value).toBe("alice@corp.com");
    expect(entry!.user_id).toBe(userA);
  });

  test("upsertKnowledge on duplicate updates existing entry", () => {
    const id2 = upsertKnowledge(
      { user_id: userA, entity: "Alice", attribute: "email", value: "alice@corp.com", source_context: "updated" },
      userA
    );
    // Same entry → same id (conflict update path)
    expect(id2).toBe(entryId);
    const entry = getKnowledgeEntry(entryId);
    expect(entry!.source_context).toBe("updated");
  });

  test("listKnowledge scoped to user", () => {
    upsertKnowledge(
      { user_id: userB, entity: "Bob", attribute: "city", value: "Berlin", source_context: null },
      userB
    );
    const aEntries = listKnowledge(userA);
    const bEntries = listKnowledge(userB);
    expect(aEntries.every((e) => e.user_id === userA)).toBe(true);
    expect(bEntries.every((e) => e.user_id === userB)).toBe(true);
  });

  test("searchKnowledge matches entity/attribute/value", () => {
    const results = searchKnowledge("Alice", userA);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entity).toBe("Alice");
  });

  test("searchKnowledge returns empty for unrelated user", () => {
    const results = searchKnowledge("Alice", userB);
    expect(results.length).toBe(0);
  });

  test("updateKnowledge modifies fields", () => {
    updateKnowledge(entryId, { value: "alice-new@corp.com" });
    const entry = getKnowledgeEntry(entryId);
    expect(entry!.value).toBe("alice-new@corp.com");
  });

  test("deleteKnowledge removes the entry", () => {
    deleteKnowledge(entryId);
    expect(getKnowledgeEntry(entryId)).toBeUndefined();
  });
});

describe("Knowledge Embeddings", () => {
  test("upsertKnowledgeEmbedding stores and retrieves", () => {
    const knowledgeId = upsertKnowledge(
      { user_id: userA, entity: "Test", attribute: "embed", value: "hello", source_context: null },
      userA
    );
    const fakeEmbedding = [0.1, 0.2, 0.3, 0.4];
    upsertKnowledgeEmbedding(knowledgeId, fakeEmbedding);

    const embeddings = listKnowledgeEmbeddings(userA);
    expect(embeddings.length).toBeGreaterThan(0);
    const found = embeddings.find((e) => e.knowledge_id === knowledgeId);
    expect(found).toBeDefined();
    expect(JSON.parse(found!.embedding)).toEqual(fakeEmbedding);
  });

  test("getKnowledgeEntriesByIds returns correct entries", () => {
    const id1 = upsertKnowledge(
      { user_id: userA, entity: "X", attribute: "a", value: "1", source_context: null }, userA
    );
    const id2 = upsertKnowledge(
      { user_id: userA, entity: "Y", attribute: "b", value: "2", source_context: null }, userA
    );
    const entries = getKnowledgeEntriesByIds([id1, id2]);
    expect(entries.length).toBe(2);
  });

  test("getKnowledgeEntriesByIds returns empty for empty input", () => {
    expect(getKnowledgeEntriesByIds([])).toEqual([]);
  });
});
