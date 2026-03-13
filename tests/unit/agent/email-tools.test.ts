/**
 * Unit tests — Built-in email tools (send + read)
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

// ── IMAP mocks ───────────────────────────────────────────────
const mockImapConnect = jest.fn(async () => {});
const mockImapLogout = jest.fn(async () => {});
const mockImapClose = jest.fn();
const mockImapSearch = jest.fn(async () => [1, 2, 3]);
const mockLockRelease = jest.fn();
const mockImapGetMailboxLock = jest.fn(async () => ({ release: mockLockRelease }));

// Iterable that yields mock IMAP messages
function makeMockFetch(messages: any[]) {
  return jest.fn(() => ({
    [Symbol.asyncIterator]: async function* () {
      for (const m of messages) yield m;
    },
  }));
}

const mockImapFetch = makeMockFetch([]);

jest.mock("imapflow", () => ({
  ImapFlow: jest.fn().mockImplementation(() => ({
    connect: mockImapConnect,
    logout: mockImapLogout,
    close: mockImapClose,
    search: mockImapSearch,
    getMailboxLock: mockImapGetMailboxLock,
    fetch: mockImapFetch,
    on: jest.fn(),
  })),
}));

const mockSimpleParser = jest.fn(async () => ({
  from: { value: [{ address: "sender@example.com" }] },
  to: { value: [{ address: "me@example.com" }] },
  subject: "Test Email",
  text: "Hello from the email body.",
  date: new Date("2026-03-13T10:00:00Z"),
}));

jest.mock("mailparser", () => ({
  simpleParser: (...args: any[]) => mockSimpleParser(...args),
}));

import { listChannels } from "@/lib/db/queries";
import { executeBuiltinEmailTool, isEmailTool } from "@/lib/tools/email-tools";

const IMAP_CHANNEL = {
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
    imapHost: "imap.example.com",
    imapPort: "993",
    imapUser: "nexus@example.com",
    imapPass: "pass123",
  }),
};

describe("executeBuiltinEmailTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("sends email using enabled email channel", async () => {
    (listChannels as jest.Mock).mockReturnValue([IMAP_CHANNEL]);

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

describe("isEmailTool", () => {
  test("matches builtin.email_send", () => {
    expect(isEmailTool("builtin.email_send")).toBe(true);
  });

  test("matches builtin.email_read", () => {
    expect(isEmailTool("builtin.email_read")).toBe(true);
  });

  test("does not match unrelated tool names", () => {
    expect(isEmailTool("builtin.web_search")).toBe(false);
    expect(isEmailTool("email_send")).toBe(false);
  });
});

describe("builtin.email_read", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listChannels as jest.Mock).mockReturnValue([IMAP_CHANNEL]);

    // Reset fetch to return a default message
    mockImapFetch.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () {
        yield {
          uid: 42,
          source: Buffer.from("mock"),
          flags: new Set(["\\Seen"]),
        };
      },
    }));

    mockSimpleParser.mockResolvedValue({
      from: { value: [{ address: "sender@example.com" }] },
      to: { value: [{ address: "me@example.com" }] },
      subject: "Test Email",
      text: "Hello from the email body.",
      date: new Date("2026-03-13T10:00:00Z"),
    } as any);
  });

  test("reads emails from IMAP and returns structured messages", async () => {
    const result = (await executeBuiltinEmailTool(
      "builtin.email_read",
      {},
      "user-1"
    )) as any;

    expect(mockImapConnect).toHaveBeenCalled();
    expect(mockImapGetMailboxLock).toHaveBeenCalledWith("INBOX");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].from).toBe("sender@example.com");
    expect(result.messages[0].subject).toBe("Test Email");
    expect(result.messages[0].snippet).toContain("Hello from the email body");
    expect(result.messages[0].seen).toBe(true);
    expect(result.folder).toBe("INBOX");
  });

  test("uses custom folder when specified", async () => {
    await executeBuiltinEmailTool(
      "builtin.email_read",
      { folder: "Sent" },
      "user-1"
    );

    expect(mockImapGetMailboxLock).toHaveBeenCalledWith("Sent");
  });

  test("clamps limit to 1–50 range", async () => {
    // limit=0 → clamps to 1
    await executeBuiltinEmailTool(
      "builtin.email_read",
      { limit: 0 },
      "user-1"
    );

    // Should still succeed (not crash)
    expect(mockImapConnect).toHaveBeenCalled();
  });

  test("filters by sender", async () => {
    // Make the message NOT match the filter
    mockSimpleParser.mockResolvedValue({
      from: { value: [{ address: "other@example.com" }] },
      to: { value: [{ address: "me@example.com" }] },
      subject: "Test",
      text: "Body",
      date: new Date("2026-03-13T10:00:00Z"),
    } as any);

    const result = (await executeBuiltinEmailTool(
      "builtin.email_read",
      { from: "sender@example.com" },
      "user-1"
    )) as any;

    expect(result.messages).toHaveLength(0);
  });

  test("filters by subject", async () => {
    mockSimpleParser.mockResolvedValue({
      from: { value: [{ address: "sender@example.com" }] },
      to: { value: [{ address: "me@example.com" }] },
      subject: "Unrelated Topic",
      text: "Body",
      date: new Date("2026-03-13T10:00:00Z"),
    } as any);

    const result = (await executeBuiltinEmailTool(
      "builtin.email_read",
      { subject: "invoice" },
      "user-1"
    )) as any;

    expect(result.messages).toHaveLength(0);
  });

  test("throws when IMAP config is missing", async () => {
    (listChannels as jest.Mock).mockReturnValue([
      {
        id: "ch-no-imap",
        channel_type: "email",
        label: "No IMAP",
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

    await expect(
      executeBuiltinEmailTool("builtin.email_read", {}, "user-1")
    ).rejects.toThrow("missing IMAP config");
  });

  test("throws for unknown email tool name", async () => {
    await expect(
      executeBuiltinEmailTool("builtin.email_unknown", {}, "user-1")
    ).rejects.toThrow("Unknown email tool");
  });

  test("returns empty list when no UIDs match", async () => {
    mockImapSearch.mockResolvedValue([]);

    const result = (await executeBuiltinEmailTool(
      "builtin.email_read",
      {},
      "user-1"
    )) as any;

    expect(result.messages).toHaveLength(0);
    expect(result.note).toContain("No messages found");
  });
});
