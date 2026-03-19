import { getDb } from "./connection";
import { stmt, PaginatedResult } from "./query-helpers";
import { env } from "@/lib/env";
import {
  decodeEmbeddingFromBinary,
  decodeEmbeddingFromJson,
  encodeEmbeddingToBinary,
  normalizeCompression,
} from "@/lib/knowledge/vector-codec";

export interface KnowledgeEntry {
  id: number;
  user_id: string | null;
  entity: string;
  attribute: string;
  value: string;
  source_type: "manual" | "chat" | "proactive";
  source_context: string | null;
  last_updated: string;
}

export function listKnowledge(userId?: string): KnowledgeEntry[] {
  if (!userId) return [];
  return getDb()
    .prepare("SELECT * FROM user_knowledge WHERE user_id = ? OR user_id IS NULL ORDER BY last_updated DESC")
    .all(userId) as KnowledgeEntry[];
}

export function listKnowledgePaginated(userId: string, limit = 100, offset = 0): PaginatedResult<KnowledgeEntry> {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as cnt FROM user_knowledge WHERE user_id = ? OR user_id IS NULL")
    .get(userId) as { cnt: number }).cnt;
  const data = db.prepare(
    "SELECT * FROM user_knowledge WHERE user_id = ? OR user_id IS NULL ORDER BY last_updated DESC LIMIT ? OFFSET ?"
  ).all(userId, limit, offset) as KnowledgeEntry[];
  return { data, total, limit, offset, hasMore: offset + data.length < total };
}

export function getKnowledgeEntry(id: number): KnowledgeEntry | undefined {
  return stmt(
    "SELECT * FROM user_knowledge WHERE id = ?"
  ).get(id) as KnowledgeEntry | undefined;
}

export function searchKnowledge(query: string, userId?: string): KnowledgeEntry[] {
  if (!userId) return [];
  const pattern = `%${query}%`;
  // UNION ALL allows SQLite to use the user_id index for both branches
  // instead of a full table scan with OR.
  // LIMIT 100 caps the result set to prevent runaway scans on large tables.
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT * FROM user_knowledge
         WHERE user_id = ? AND (entity LIKE ? OR attribute LIKE ? OR value LIKE ?)
         UNION ALL
         SELECT * FROM user_knowledge
         WHERE user_id IS NULL AND (entity LIKE ? OR attribute LIKE ? OR value LIKE ?)
       )
       ORDER BY last_updated DESC
       LIMIT 100`
    )
    .all(userId, pattern, pattern, pattern, pattern, pattern, pattern) as KnowledgeEntry[];
}

export function upsertKnowledge(
  entry: Omit<KnowledgeEntry, "id" | "last_updated" | "source_type"> & { source_type?: KnowledgeEntry["source_type"] },
  userId?: string
): number {
  const normalizeFactText = (input: string) => input.replace(/\s+/g, " ").trim();
  const uid = entry.user_id || userId || null;
  const sourceType = entry.source_type ?? "manual";

  const entity = normalizeFactText(entry.entity);
  const attribute = normalizeFactText(entry.attribute);
  const value = normalizeFactText(entry.value);
  const sourceContext = typeof entry.source_context === "string"
    ? entry.source_context.slice(0, 220)
    : entry.source_context;

  // Merge near-duplicates that differ only by case/whitespace into one canonical row.
  const existing = getDb()
    .prepare(
      `SELECT id
       FROM user_knowledge
       WHERE ((? IS NULL AND user_id IS NULL) OR user_id = ?)
         AND lower(trim(entity)) = lower(trim(?))
         AND lower(trim(attribute)) = lower(trim(?))
         AND lower(trim(value)) = lower(trim(?))
       ORDER BY last_updated DESC, id DESC
       LIMIT 1`
    )
    .get(uid, uid, entity, attribute, value) as { id: number } | undefined;

  if (existing) {
    getDb()
      .prepare(
        `UPDATE user_knowledge
         SET entity = ?,
             attribute = ?,
             value = ?,
             source_type = ?,
             source_context = ?,
             last_updated = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(entity, attribute, value, sourceType, sourceContext, existing.id);
    return existing.id;
  }

  const row = getDb()
    .prepare(
      `INSERT INTO user_knowledge (user_id, entity, attribute, value, source_type, source_context)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, entity, attribute, value) DO UPDATE SET
         value = excluded.value,
         source_type = excluded.source_type,
         source_context = excluded.source_context,
         last_updated = CURRENT_TIMESTAMP
       RETURNING id`
    )
    .get(uid, entity, attribute, value, sourceType, sourceContext) as { id: number } | undefined;

  if (!row) {
    throw new Error("Failed to upsert knowledge entry");
  }

  return row.id;
}

export function updateKnowledge(id: number, entry: Partial<Pick<KnowledgeEntry, "entity" | "attribute" | "value">>): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (entry.entity !== undefined) { sets.push("entity = ?"); vals.push(entry.entity); }
  if (entry.attribute !== undefined) { sets.push("attribute = ?"); vals.push(entry.attribute); }
  if (entry.value !== undefined) { sets.push("value = ?"); vals.push(entry.value); }
  sets.push("last_updated = CURRENT_TIMESTAMP");
  vals.push(id);
  getDb().prepare(`UPDATE user_knowledge SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function deleteKnowledge(id: number): void {
  getDb().prepare("DELETE FROM user_knowledge WHERE id = ?").run(id);
}

interface KnowledgeEmbeddingRow {
  knowledge_id: number;
  embedding: string | null;
  embedding_bin: Buffer | null;
  embedding_encoding: string | null;
  compression: string | null;
  is_archived?: number;
}

export interface ParsedKnowledgeEmbeddingRow {
  knowledge_id: number;
  embedding: number[];
}

export function upsertKnowledgeEmbedding(knowledgeId: number, embedding: number[]): void {
  const compression = normalizeCompression(env.EMBEDDING_COMPRESSION);
  const encoded = encodeEmbeddingToBinary(embedding, compression);
  getDb()
    .prepare(
      `INSERT INTO knowledge_embeddings (
         knowledge_id, embedding, embedding_bin, embedding_encoding, compression, is_archived, updated_at
       )
       VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
       ON CONFLICT(knowledge_id) DO UPDATE SET
         embedding = excluded.embedding,
         embedding_bin = excluded.embedding_bin,
         embedding_encoding = excluded.embedding_encoding,
         compression = excluded.compression,
         is_archived = 0,
         updated_at = CURRENT_TIMESTAMP`
    )
    .run(knowledgeId, JSON.stringify(embedding), encoded.binary, encoded.encoding, encoded.compression);
}

/** List embeddings scoped to a user (via JOIN on user_knowledge) */
export function listKnowledgeEmbeddings(userId?: string): ParsedKnowledgeEmbeddingRow[] {
  if (!userId) return [];
  const rows = getDb()
    .prepare(
      `SELECT
         ke.knowledge_id,
         ke.embedding,
         ke.embedding_bin,
         ke.embedding_encoding,
         ke.compression,
         ke.is_archived
       FROM knowledge_embeddings ke
       JOIN user_knowledge uk ON ke.knowledge_id = uk.id
       WHERE (uk.user_id = ? OR uk.user_id IS NULL)
         AND coalesce(ke.is_archived, 0) = 0`
    )
    .all(userId) as KnowledgeEmbeddingRow[];

  const parsed: ParsedKnowledgeEmbeddingRow[] = [];
  for (const row of rows) {
    const fromBinary = row.embedding_bin
      ? decodeEmbeddingFromBinary(
          row.embedding_bin,
          row.embedding_encoding || "f32le",
          row.compression || "none"
        )
      : null;
    const vector = fromBinary || decodeEmbeddingFromJson(row.embedding);
    if (vector && vector.length > 0) {
      parsed.push({ knowledge_id: row.knowledge_id, embedding: vector });
    }
  }
  return parsed;
}

export function listKnowledgeEntriesForArchival(cutoffDays: number, limit = 500): KnowledgeEntry[] {
  return getDb()
    .prepare(
      `SELECT *
       FROM user_knowledge
       WHERE last_updated < datetime('now', '-' || ? || ' days')
       ORDER BY last_updated ASC
       LIMIT ?`
    )
    .all(cutoffDays, limit) as KnowledgeEntry[];
}

export function getKnowledgeEntriesByIds(ids: number[]): KnowledgeEntry[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return getDb()
    .prepare(`SELECT * FROM user_knowledge WHERE id IN (${placeholders})`)
    .all(...ids) as KnowledgeEntry[];
}
