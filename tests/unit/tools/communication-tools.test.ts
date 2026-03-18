/**
 * @jest-environment node
 */

import { CommunicationTools, BUILTIN_COMMUNICATION_TOOLS, COMMUNICATION_TOOL_NAMES } from "@/lib/tools/communication-tools";

jest.mock("@/lib/db", () => ({
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
  getDb: jest.fn(() => ({
    prepare: jest.fn(() => ({ all: jest.fn(() => []) })),
  })),
  getThreadMessages: jest.fn(() => []),
}));

describe("CommunicationTools channel_notify", () => {
  test("includes builtin.channel_notify in tool definitions", () => {
    const names = BUILTIN_COMMUNICATION_TOOLS.map((tool) => tool.name);
    expect(names).toContain(COMMUNICATION_TOOL_NAMES.NOTIFY);
  });

  test("recognizes builtin.channel_notify as communication tool", () => {
    expect(CommunicationTools.isCommunicationTool(COMMUNICATION_TOOL_NAMES.NOTIFY)).toBe(true);
  });

  test("executes notify by reusing send logic with default subject", async () => {
    const sendMock = jest.fn(async () => undefined);
    const canSendMock = jest.fn(() => true);
    const factory = {
      create: jest.fn(() => ({
        canSend: canSendMock,
        send: sendMock,
      })),
    } as any;

    const tools = new CommunicationTools(factory);

    const result = await tools.execute(
      COMMUNICATION_TOOL_NAMES.NOTIFY,
      {
        channelType: "email",
        to: "user@example.com",
        message: "System check complete",
      },
      { threadId: "thread-1", userId: "user-1" },
    );

    expect(canSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        subject: "Nexus Notification",
        message: "System check complete",
        emailRecipient: "user@example.com",
      }),
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        status: "sent",
        channelType: "email",
        subject: "Nexus Notification",
      }),
    );
  });
});
