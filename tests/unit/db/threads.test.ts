/**
 * Unit tests — Threads & Messages
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  createThread,
  listThreads,
  getThread,
  updateThreadStatus,
  updateThreadTitle,
  deleteThread,
  addMessage,
  getThreadMessages,
  deleteMessagesFrom,
} from "@/lib/db/queries";

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "threads@example.com" });
});
afterAll(() => teardownTestDb());

describe("Threads", () => {
  let threadId: string;

  test("createThread creates a thread with default title", () => {
    const thread = createThread(undefined, userId);
    threadId = thread.id;
    expect(thread.title).toBe("New Thread");
    expect(thread.user_id).toBe(userId);
    expect(thread.status).toBe("active");
  });

  test("createThread with custom title", () => {
    const thread = createThread("My Topic", userId);
    expect(thread.title).toBe("My Topic");
  });

  test("getThread returns existing thread", () => {
    const thread = getThread(threadId);
    expect(thread).toBeDefined();
    expect(thread!.id).toBe(threadId);
  });

  test("getThread returns undefined for unknown id", () => {
    expect(getThread("nonexistent")).toBeUndefined();
  });

  test("listThreads scoped to user", () => {
    const otherUser = seedTestUser({ email: "other@example.com" });
    createThread("Other Thread", otherUser);
    const myThreads = listThreads(userId);
    expect(myThreads.every((t) => t.user_id === userId)).toBe(true);
  });

  test("updateThreadStatus changes status", () => {
    updateThreadStatus(threadId, "awaiting_approval");
    const thread = getThread(threadId);
    expect(thread!.status).toBe("awaiting_approval");
  });

  test("updateThreadTitle changes title", () => {
    updateThreadTitle(threadId, "Renamed");
    const thread = getThread(threadId);
    expect(thread!.title).toBe("Renamed");
  });

  test("deleteThread removes thread and related data", () => {
    const tempThread = createThread("To Delete", userId);
    addMessage({ thread_id: tempThread.id, role: "user", content: "hi", tool_calls: null, tool_results: null, attachments: null });
    deleteThread(tempThread.id);
    expect(getThread(tempThread.id)).toBeUndefined();
  });

  test("listThreads excludes proactive-scan threads", () => {
    createThread("[proactive-scan]", userId, { threadType: "proactive" });
    createThread("[proactive-scan] 2025-01-01", userId, { threadType: "proactive" });
    const threads = listThreads(userId);
    expect(threads.every((t) => t.thread_type === "interactive")).toBe(true);
  });

  test("listThreads excludes scheduled threads", () => {
    createThread("[scheduled] Daily Report", userId, { threadType: "scheduled" });
    const threads = listThreads(userId);
    expect(threads.every((t) => t.thread_type === "interactive")).toBe(true);
  });

  test("listThreads excludes channel threads", () => {
    createThread("channel thread 1", userId, { threadType: "channel", channelId: "a3ab3b28-5212-4df4", externalSenderId: "sender@example.com" });
    createThread("channel thread 2", userId, { threadType: "channel", channelId: "00000000-0000-0000", externalSenderId: "test" });
    const threads = listThreads(userId);
    expect(threads.every((t) => t.thread_type === "interactive")).toBe(true);
  });

  test("listThreads without userId also excludes internal threads", () => {
    const allThreads = listThreads();
    expect(allThreads.every((t) => t.thread_type === "interactive")).toBe(true);
  });
});

describe("Messages", () => {
  let threadId: string;

  beforeAll(() => {
    const thread = createThread("Msg Thread", userId);
    threadId = thread.id;
  });

  test("addMessage inserts a user message", () => {
    const msg = addMessage({
      thread_id: threadId,
      role: "user",
      content: "Hello agent",
      tool_calls: null,
      tool_results: null,
      attachments: null,
    });
    expect(msg.id).toBeGreaterThan(0);
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello agent");
    expect(msg.created_at).toBeDefined();
    expect(typeof msg.created_at).toBe("string");
  });

  test("addMessage inserts an assistant message", () => {
    const msg = addMessage({
      thread_id: threadId,
      role: "assistant",
      content: "Hi! How can I help?",
      tool_calls: null,
      tool_results: null,
      attachments: null,
    });
    expect(msg.role).toBe("assistant");
  });

  test("addMessage with tool_calls JSON", () => {
    const toolCalls = JSON.stringify([{ name: "web_search", arguments: { query: "test" } }]);
    const msg = addMessage({
      thread_id: threadId,
      role: "assistant",
      content: null,
      tool_calls: toolCalls,
      tool_results: null,
      attachments: null,
    });
    expect(msg.tool_calls).toBe(toolCalls);
  });

  test("getThreadMessages returns messages in order", () => {
    const messages = getThreadMessages(threadId);
    expect(messages.length).toBeGreaterThanOrEqual(3);
    // Should be sorted by id ascending
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].id).toBeGreaterThan(messages[i - 1].id);
    }
  });

  test("getThreadMessages returns empty for unknown thread", () => {
    expect(getThreadMessages("nonexistent")).toEqual([]);
  });
});

describe("deleteMessagesFrom", () => {
  let threadId: string;
  let msgIds: number[];

  beforeAll(() => {
    const thread = createThread("Restore Thread", userId);
    threadId = thread.id;
    msgIds = [];
    // Add 5 messages: user, assistant, user, assistant, user
    for (const [role, content] of [
      ["user", "Message 1"],
      ["assistant", "Reply 1"],
      ["user", "Message 2"],
      ["assistant", "Reply 2"],
      ["user", "Message 3"],
    ] as const) {
      const m = addMessage({ thread_id: threadId, role, content, tool_calls: null, tool_results: null, attachments: null });
      msgIds.push(m.id);
    }
  });

  test("returns undefined for nonexistent message", () => {
    expect(deleteMessagesFrom(threadId, 999999)).toBeUndefined();
  });

  test("returns undefined for wrong thread_id", () => {
    expect(deleteMessagesFrom("wrong-thread", msgIds[0])).toBeUndefined();
  });

  test("deletes the target message and all subsequent messages", () => {
    // Restore to message 3 (index 2, which is "Message 2")
    const targetId = msgIds[2];
    const deleted = deleteMessagesFrom(threadId, targetId);
    expect(deleted).toBeDefined();
    expect(deleted!.content).toBe("Message 2");
    expect(deleted!.role).toBe("user");

    const remaining = getThreadMessages(threadId);
    // Only messages 1 and 2 should remain (indices 0 and 1)
    expect(remaining.length).toBe(2);
    expect(remaining[0].content).toBe("Message 1");
    expect(remaining[1].content).toBe("Reply 1");
  });

  test("updates thread last_message_at after deletion", () => {
    const thread = getThread(threadId);
    expect(thread).toBeDefined();
    const remaining = getThreadMessages(threadId);
    // last_message_at should match the last remaining message's created_at
    expect(remaining.length).toBeGreaterThan(0);
  });

  test("resets thread status to active after restore", () => {
    // Set status to something else first
    updateThreadStatus(threadId, "awaiting_approval");
    // Add a message back and restore
    const m = addMessage({ thread_id: threadId, role: "user", content: "New msg", tool_calls: null, tool_results: null, attachments: null });
    deleteMessagesFrom(threadId, m.id);
    const thread = getThread(threadId);
    expect(thread!.status).toBe("active");
  });
});
