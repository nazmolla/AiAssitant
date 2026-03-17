/**
 * Unit tests for phone-service TwiML generation.
 * Covers both announcement-only mode (no actionUrl) and
 * two-way conversation mode (with actionUrl + Gather block).
 */

import { buildTwimlResponse, escapeXml } from "@/lib/services/phone-service";

describe("buildTwimlResponse", () => {
  test("returns announcement-only TwiML when no actionUrl is provided", () => {
    const twiml = buildTwimlResponse("Hello from Nexus.", "");
    expect(twiml).toContain("<Say");
    expect(twiml).toContain("Hello from Nexus.");
    expect(twiml).not.toContain("<Gather");
    expect(twiml).not.toContain("Goodbye");
    expect(twiml).toMatch(/<Response>/);
    expect(twiml).toMatch(/<\/Response>/);
  });

  test("returns TwiML with Gather block when actionUrl is provided", () => {
    const actionUrl = "https://nexus.example.com/api/channels/ch-1/webhook?secret=abc";
    const twiml = buildTwimlResponse("You have a meeting in 15 minutes.", actionUrl);
    expect(twiml).toContain("<Gather");
    expect(twiml).toContain(`action="${escapeXml(actionUrl)}"`);
    expect(twiml).toContain("input=\"speech\"");
    expect(twiml).toContain("You have a meeting in 15 minutes.");
    expect(twiml).toContain("Goodbye");
  });

  test("uses provided voice name in Say elements", () => {
    const twiml = buildTwimlResponse("Test message.", "https://example.com/cb", "Polly.Joanna");
    expect(twiml).toContain('voice="Polly.Joanna"');
  });

  test("defaults to alice voice when voice is empty", () => {
    const twiml = buildTwimlResponse("Test message.", "", "");
    expect(twiml).toContain('voice="alice"');
  });

  test("truncates very long messages to 2000 characters", () => {
    const longMessage = "a".repeat(3000);
    const twiml = buildTwimlResponse(longMessage, "");
    expect(twiml).toContain("a".repeat(2000));
    expect(twiml).not.toContain("a".repeat(2001));
  });

  test("escapes XML special characters in message to prevent injection", () => {
    const message = 'Hello <user> & "world" \'test\'';
    const twiml = buildTwimlResponse(message, "");
    expect(twiml).toContain("Hello &lt;user&gt; &amp; &quot;world&quot; &apos;test&apos;");
    expect(twiml).not.toContain("<user>");
  });

  test("escapes XML special characters in actionUrl", () => {
    const actionUrl = "https://example.com/cb?secret=tok&other=val";
    const twiml = buildTwimlResponse("Hello", actionUrl);
    expect(twiml).toContain("tok&amp;other=val");
    expect(twiml).not.toContain("tok&other=val");
  });

  test("returns fallback message when reply is empty", () => {
    const twiml = buildTwimlResponse("", "");
    expect(twiml).toContain("I did not catch that. Please repeat.");
  });

  test("Gather block points to the provided action URL for conversation continuation", () => {
    const channelId = "ch-test-123";
    const secret = "mysecret";
    const actionUrl = `https://nexus.example.com/api/channels/${channelId}/webhook?secret=${secret}`;
    const twiml = buildTwimlResponse("Your reminder is ready.", actionUrl);
    // Gather action must point back to the webhook so Twilio sends speech input
    expect(twiml).toContain(`/api/channels/${channelId}/webhook`);
    expect(twiml).toContain(secret);
  });
});

describe("escapeXml", () => {
  test.each([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot;"],
    ["'", "&apos;"],
    ["plain text", "plain text"],
    ["a&b<c>d\"e'f", "a&amp;b&lt;c&gt;d&quot;e&apos;f"],
  ])("escapes %s to %s", (input, expected) => {
    expect(escapeXml(input)).toBe(expected);
  });
});
