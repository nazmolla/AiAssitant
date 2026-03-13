import { getDb } from "./connection";
import { stmt, type PaginatedResult } from "./query-helpers";
import { v4 as uuid } from "uuid";

export interface Thread {
  id: string;
  user_id: string | null;
  title: string | null;
  thread_type: "interactive" | "proactive" | "scheduled" | "channel";
  is_interactive: number;
  channel_id: string | null;
  external_sender_id: string | null;
  status: string;
  last_message_at: string;
}

export interface CreateThreadOptions {
  threadType?: "interactive" | "proactive" | "scheduled" | "channel";
  channelId?: string;
  externalSenderId?: string;
  status?: string;
}

export function createThread(title?: string, userId?: string, options?: CreateThreadOptions): Thread {
  const id = uuid();
  const threadType = options?.threadType ?? "interactive";
  const isInteractive = threadType === "interactive" ? 1 : 0;
  const status = options?.status ?? "active";
  return getDb()
    .prepare(
      `INSERT INTO threads (id, user_id, title, thread_type, is_interactive, channel_id, external_sender_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      id,
      userId ?? null,
      title || "New Thread",
      threadType,
      isInteractive,
      options?.channelId ?? null,
      options?.externalSenderId ?? null,
      status
    ) as Thread;
}

export function listThreads(userId?: string): Thread[] {
  if (userId) {
    return getDb()
      .prepare("SELECT * FROM threads WHERE user_id = ? AND thread_type = 'interactive' AND is_interactive = 1 ORDER BY last_message_at DESC")
      .all(userId) as Thread[];
  }
  return getDb()
    .prepare("SELECT * FROM threads WHERE thread_type = 'interactive' AND is_interactive = 1 ORDER BY last_message_at DESC")
    .all() as Thread[];
}

const THREAD_FILTER = "thread_type = 'interactive' AND is_interactive = 1";

export function listThreadsPaginated(userId: string, limit = 50, offset = 0): PaginatedResult<Thread> {
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM threads WHERE user_id = ? AND ${THREAD_FILTER}`)
    .get(userId) as { cnt: number }).cnt;
  const data = db.prepare(
    `SELECT * FROM threads WHERE user_id = ? AND ${THREAD_FILTER} ORDER BY last_message_at DESC LIMIT ? OFFSET ?`
  ).all(userId, limit, offset) as Thread[];
  return { data, total, limit, offset, hasMore: offset + data.length < total };
}

export function getThread(id: string): Thread | undefined {
  return stmt("SELECT * FROM threads WHERE id = ?").get(id) as Thread | undefined;
}

export function findActiveChannelThread(channelId: string, senderId: string, userId?: string | null): Thread | undefined {
  if (userId) {
    return getDb()
      .prepare(
        `SELECT * FROM threads
         WHERE thread_type = 'channel'
           AND channel_id = ?
           AND external_sender_id = ?
           AND user_id = ?
           AND status = 'active'
         ORDER BY last_message_at DESC
         LIMIT 1`
      )
      .get(channelId, senderId, userId) as Thread | undefined;
  }

  return getDb()
    .prepare(
      `SELECT * FROM threads
       WHERE thread_type = 'channel'
         AND channel_id = ?
         AND external_sender_id = ?
         AND status = 'active'
       ORDER BY last_message_at DESC
       LIMIT 1`
    )
    .get(channelId, senderId) as Thread | undefined;
}

export function updateThreadStatus(id: string, status: string): void {
  getDb().prepare("UPDATE threads SET status = ? WHERE id = ?").run(status, id);
}

export function updateThreadTitle(id: string, title: string): void {
  getDb().prepare("UPDATE threads SET title = ? WHERE id = ?").run(title, id);
}

export function deleteThread(id: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM attachments WHERE thread_id = ?").run(id);
    db.prepare("DELETE FROM approval_queue WHERE thread_id = ?").run(id);
    db.prepare("DELETE FROM messages WHERE thread_id = ?").run(id);
    db.prepare("DELETE FROM threads WHERE id = ?").run(id);
  })();
}

export interface Message {
  id: number;
  thread_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls: string | null;
  tool_results: string | null;
  attachments: string | null;           // JSON array of AttachmentMeta
  created_at: string | null;            // ISO timestamp
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

export function addMessage(msg: Omit<Message, "id" | "created_at">): Message {
  const db = getDb();
  const row = db
    .prepare(
      `INSERT INTO messages (thread_id, role, content, tool_calls, tool_results, attachments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       RETURNING *`
    )
    .get(msg.thread_id, msg.role, msg.content, msg.tool_calls, msg.tool_results, msg.attachments ?? null) as Message;

  stmt(
    "UPDATE threads SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(msg.thread_id);

  return row;
}

export interface AttachmentRecord {
  id: string;
  thread_id: string;
  message_id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

export function addAttachment(att: Omit<AttachmentRecord, "created_at">): void {
  getDb()
    .prepare(
      `INSERT INTO attachments (id, thread_id, message_id, filename, mime_type, size_bytes, storage_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(att.id, att.thread_id, att.message_id, att.filename, att.mime_type, att.size_bytes, att.storage_path);
}

export function getAttachment(id: string): AttachmentRecord | undefined {
  return stmt("SELECT * FROM attachments WHERE id = ?").get(id) as AttachmentRecord | undefined;
}

export function getMessageAttachments(messageId: number): AttachmentRecord[] {
  return stmt("SELECT * FROM attachments WHERE message_id = ? ORDER BY created_at ASC").all(messageId) as AttachmentRecord[];
}

export function getThreadMessages(threadId: string): Message[] {
  return stmt(
    "SELECT * FROM messages WHERE thread_id = ? ORDER BY id ASC"
  ).all(threadId) as Message[];
}
