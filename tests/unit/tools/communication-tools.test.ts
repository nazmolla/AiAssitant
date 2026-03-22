/**
 * @jest-environment node
 */

import { CommunicationTools, BUILTIN_COMMUNICATION_TOOLS, COMMUNICATION_TOOL_NAMES } from "@/lib/tools/communication-tools";

const mockCreateNotification = jest.fn((n: any) => ({
  id: "notif-1",
  user_id: n.userId,
  type: n.type,
  title: n.title,
  body: n.body ?? null,
  metadata: null,
  read: 0,
  created_at: new Date().toISOString(),
}));

jest.mock("@/lib/db/notification-queries", () => ({
  createNotification: (...args: any[]) => mockCreateNotification(...args),
}));

jest.mock("@/lib/db/channel-queries", () => ({
  listChannels: jest.fn(() => [
    {
      id: "channel-1",
      user_id: "user-1",
      channel_type: "email",
      label: "Primary Email",
      enabled: 1,
    },
  ]),
  listChannelUserMappings: jest.fn(() => []),
}));

jest.mock("@/lib/db/thread-queries", () => ({
  getThreadMessages: jest.fn(() => []),
}));

jest.mock("@/lib/db/connection", () => ({
  getDb: jest.fn(() => ({
    prepare: jest.fn(() => ({ all: jest.fn(() => []) })),
  })),
}));

describe("CommunicationTools channel_notify", () => {
  beforeEach(() => {
    mockCreateNotification.mockClear();
  });

  test("includes builtin.channel_notify in tool definitions", () => {
    const names = BUILTIN_COMMUNICATION_TOOLS.map((tool) => tool.name);
    expect(names).toContain(COMMUNICATION_TOOL_NAMES.NOTIFY);
  });

  test("recognizes builtin.channel_notify as communication tool", () => {
    expect(CommunicationTools.isCommunicationTool(COMMUNICATION_TOOL_NAMES.NOTIFY)).toBe(true);
  });

  test("creates an in-app notification with title and message", async () => {
    const tools = new CommunicationTools();

    const result = await tools.execute(
      COMMUNICATION_TOOL_NAMES.NOTIFY,
      {
        title: "System check complete",
        message: "All devices are online.",
      },
      { threadId: "thread-1", userId: "user-1" },
    );

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "info",
        title: "System check complete",
        body: "All devices are online.",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: "notified",
        notificationId: "notif-1",
        type: "info",
        title: "System check complete",
      }),
    );
  });

  test("accepts a custom notification type", async () => {
    const tools = new CommunicationTools();

    await tools.execute(
      COMMUNICATION_TOOL_NAMES.NOTIFY,
      {
        title: "Proactive insight",
        message: "A pattern was detected.",
        type: "proactive_action",
      },
      { threadId: "thread-1", userId: "user-1" },
    );

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "proactive_action" }),
    );
  });

  test("defaults unknown type to info", async () => {
    const tools = new CommunicationTools();

    await tools.execute(
      COMMUNICATION_TOOL_NAMES.NOTIFY,
      { title: "Alert", message: "Something happened.", type: "invalid_type" },
      { threadId: "thread-1", userId: "user-1" },
    );

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "info" }),
    );
  });

  test("throws when title or message is missing", async () => {
    const tools = new CommunicationTools();

    await expect(
      tools.execute(
        COMMUNICATION_TOOL_NAMES.NOTIFY,
        { message: "No title here" },
        { threadId: "thread-1", userId: "user-1" },
      ),
    ).rejects.toThrow("Missing required args: title, message.");
  });

  test("does NOT call external channel send for notify", async () => {
    const sendMock = jest.fn(async () => undefined);
    const factory = { create: jest.fn(() => ({ canSend: jest.fn(() => true), send: sendMock })) } as any;
    const tools = new CommunicationTools(factory);

    await tools.execute(
      COMMUNICATION_TOOL_NAMES.NOTIFY,
      { title: "Test", message: "In-app only" },
      { threadId: "thread-1", userId: "user-1" },
    );

    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("CommunicationTools channel_receive since parameter", () => {
  const mockPrepare = jest.fn();
  const mockAll = jest.fn();

  beforeEach(() => {
    mockAll.mockReturnValue([]);
    mockPrepare.mockReturnValue({ all: mockAll });
    const { getDb } = require("@/lib/db/connection");
    (getDb as jest.Mock).mockReturnValue({ prepare: mockPrepare });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("channel_receive schema includes since field", () => {
    const receiveTool = BUILTIN_COMMUNICATION_TOOLS.find((t) => t.name === COMMUNICATION_TOOL_NAMES.RECEIVE);
    expect(receiveTool).toBeDefined();
    expect(receiveTool!.inputSchema.properties).toHaveProperty("since");
  });

  test("channel_receive without since does not add timestamp filter to query", async () => {
    const tools = new CommunicationTools();
    await tools.execute(
      COMMUNICATION_TOOL_NAMES.RECEIVE,
      { channelType: "email" },
      { threadId: "thread-1", userId: "user-1" },
    );
    const capturedQuery: string = mockPrepare.mock.calls[0][0];
    expect(capturedQuery).not.toContain("last_message_at >=");
  });

  test("channel_receive with since adds timestamp filter to query", async () => {
    const tools = new CommunicationTools();
    await tools.execute(
      COMMUNICATION_TOOL_NAMES.RECEIVE,
      { channelType: "email", since: "2026-03-22T00:00:00.000Z" },
      { threadId: "thread-1", userId: "user-1" },
    );
    const capturedQuery: string = mockPrepare.mock.calls[0][0];
    expect(capturedQuery).toContain("last_message_at >=");
    const capturedParams = mockAll.mock.calls[0];
    expect(capturedParams).toContain("2026-03-22T00:00:00.000Z");
  });
});
