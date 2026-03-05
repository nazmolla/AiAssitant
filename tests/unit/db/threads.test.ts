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
    createThread("[proactive-scan]", userId);
    createThread("[proactive-scan] 2025-01-01", userId);
    const threads = listThreads(userId);
    expect(threads.every((t) => !t.title?.startsWith("[proactive-scan]"))).toBe(true);
  });

  test("listThreads excludes scheduled threads", () => {
    createThread("[scheduled] Daily Report", userId);
    const threads = listThreads(userId);
    expect(threads.every((t) => !t.title?.startsWith("[scheduled]"))).toBe(true);
  });

  test("listThreads without userId also excludes internal threads", () => {
    const allThreads = listThreads();
    expect(allThreads.every((t) => !t.title?.startsWith("[proactive-scan]"))).toBe(true);
    expect(allThreads.every((t) => !t.title?.startsWith("[scheduled]"))).toBe(true);
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
