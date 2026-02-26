/**
 * Unit tests — Built-in email tool
 */

jest.mock("@/lib/db/queries", () => ({
  listChannels: jest.fn(),
}));

const mockSendMail = jest.fn(async () => ({ messageId: "mid-1" }));
jest.mock("nodemailer", () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
}));

import { listChannels } from "@/lib/db/queries";
import { executeBuiltinEmailTool } from "@/lib/agent/email-tools";

describe("executeBuiltinEmailTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("sends email using enabled email channel", async () => {
    (listChannels as jest.Mock).mockReturnValue([
      {
        id: "ch-email-1",
        channel_type: "email",
        label: "Primary Email",
        enabled: 1,
        config_json: JSON.stringify({
          smtpHost: "smtp.example.com",
          smtpPort: "587",
          smtpUser: "nexus@example.com",
          smtpPass: "pass123",
          fromAddress: "nexus@example.com",
        }),
      },
    ]);

    const result = await executeBuiltinEmailTool(
      "builtin.email_send",
      {
        to: "admin@example.com",
        subject: "Test",
        body: "Hello",
      },
      "user-1"
    );

    expect(mockSendMail).toHaveBeenCalled();
    expect((result as any).status).toBe("sent");
    expect((result as any).to).toBe("admin@example.com");
  });

  test("throws when no enabled email channel exists", async () => {
    (listChannels as jest.Mock).mockReturnValue([]);

    await expect(
      executeBuiltinEmailTool(
        "builtin.email_send",
        { to: "admin@example.com", subject: "Test", body: "Hello" },
        "user-1"
      )
    ).rejects.toThrow("No enabled Email channel found");
  });
});
