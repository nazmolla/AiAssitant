/**
 * Unit tests — persistKnowledgeFromTurn source tagging
 *
 * Validates that knowledge from proactive scans and scheduled tasks
 * gets tagged with "proactive:<threadId>" while regular chat knowledge
 * gets tagged with "chat:<threadId>".
 */

/* ── Mock dependencies ─────────────────────────────────────────────── */

const mockIngest = jest.fn().mockResolvedValue([]);
jest.mock("@/lib/knowledge", () => ({
  ingestKnowledgeFromText: mockIngest,
}));

const mockGetThread = jest.fn();
jest.mock("@/lib/db", () => {
  const actual = jest.requireActual("@/lib/db");
  return { ...actual, getThread: mockGetThread };
});

import { persistKnowledgeFromTurn } from "@/lib/agent/loop";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("persistKnowledgeFromTurn source tagging", () => {
  const THREAD_ID = "abc-123";
  const SNIPPETS = ["User prefers dark mode"];
  const USER_ID = "user-1";

  test("tags regular chat threads with chat: prefix", async () => {
    mockGetThread.mockReturnValue({ id: THREAD_ID, title: "General conversation" });

    await persistKnowledgeFromTurn(THREAD_ID, SNIPPETS, USER_ID);

    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({ source: `chat:${THREAD_ID}` })
    );
  });

  test("tags proactive-scan threads with proactive: prefix", async () => {
    mockGetThread.mockReturnValue({ id: THREAD_ID, title: "[proactive-scan]" });

    await persistKnowledgeFromTurn(THREAD_ID, SNIPPETS, USER_ID);

    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({ source: `proactive:${THREAD_ID}` })
    );
  });

  test("tags scheduled task threads with proactive: prefix", async () => {
    mockGetThread.mockReturnValue({ id: THREAD_ID, title: "[scheduled] Daily briefing" });

    await persistKnowledgeFromTurn(THREAD_ID, SNIPPETS, USER_ID);

    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({ source: `proactive:${THREAD_ID}` })
    );
  });

  test("falls back to chat: when thread lookup fails", async () => {
    mockGetThread.mockImplementation(() => { throw new Error("DB error"); });

    await persistKnowledgeFromTurn(THREAD_ID, SNIPPETS, USER_ID);

    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({ source: `chat:${THREAD_ID}` })
    );
  });

  test("skips ingestion for empty snippets", async () => {
    await persistKnowledgeFromTurn(THREAD_ID, [], USER_ID);
    await persistKnowledgeFromTurn(THREAD_ID, ["  ", ""], USER_ID);

    expect(mockIngest).not.toHaveBeenCalled();
  });
});
