import { buildThemedEmailBody, getEmailChannelConfig, isValidPort } from "@/lib/channels/email-transport";

describe("buildThemedEmailBody", () => {
  test("renders key-value lines as structured details", () => {
    const content = buildThemedEmailBody(
      "Nexus Alert",
      "Tool: list_lights\nApproval: 123\nReason: Check status"
    );

    expect(content.html).toContain("<th");
    expect(content.html).toContain("Field");
    expect(content.html).toContain("Value");
    expect(content.text).toContain("Details:");
    expect(content.text).toContain("- Tool: list_lights");
  });

  test("renders custom table rows for digest emails", () => {
    const content = buildThemedEmailBody(
      "Nexus Proactive Digest (2)",
      "Here is your proactive digest.",
      {
        table: {
          headers: ["Issue", "Required action", "Where to do the action"],
          rows: [
            ["Light status unknown", "Review approval abc", "Approvals"],
            ["Unknown inbound email", "Review sender summary", "Channels / Logs"],
          ],
        },
      }
    );

    expect(content.html).toContain("Issue");
    expect(content.html).toContain("Required action");
    expect(content.html).toContain("Where to do the action");
    expect(content.text).toContain("Issue | Required action | Where to do the action");
  });

  test("escapes html in table and body", () => {
    const content = buildThemedEmailBody(
      "Nexus <Alert>",
      "Tool: <script>alert(1)</script>",
      {
        table: {
          headers: ["Issue"],
          rows: [["<b>unsafe</b>"]],
        },
      }
    );

    expect(content.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(content.html).toContain("&lt;b&gt;unsafe&lt;/b&gt;");
    expect(content.html).not.toContain("<script>");
  });
});

describe("getEmailChannelConfig", () => {
  test("normalizes host values and falls back to default ports for empty strings", () => {
    const cfg = getEmailChannelConfig({
      smtpHost: "https://smtp.example.com:587",
      smtpPort: "",
      smtpUser: "user@example.com",
      smtpPass: "pass",
      fromAddress: "from@example.com",
      imapHost: "imap.example.com:993",
      imapPort: "",
      imapUser: "user@example.com",
      imapPass: "pass",
    });

    expect(cfg.smtpHost).toBe("smtp.example.com");
    expect(cfg.smtpPort).toBe(587);
    expect(cfg.imapHost).toBe("imap.example.com");
    expect(cfg.imapPort).toBe(993);
  });

  test("rejects invalid ports via isValidPort", () => {
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(70000)).toBe(false);
    expect(isValidPort(587)).toBe(true);
  });
});
