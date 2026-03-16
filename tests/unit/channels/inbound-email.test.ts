import { summarizeInboundUnknownEmail } from "@/lib/services/email-service-client";

describe("summarizeInboundUnknownEmail", () => {
  it("classifies system sender with security keywords as system/low", () => {
    const result = summarizeInboundUnknownEmail(
      "no-reply@accounts.google.com",
      "2-Step Verification turned on",
      "Your Google Account is now protected with 2-Step Verification."
    );
    expect(result.category).toBe("system");
    expect(result.level).toBe("low");
  });

  it("classifies non-system sender with security keywords as security/high", () => {
    const result = summarizeInboundUnknownEmail(
      "stranger@example.com",
      "Password changed",
      "Your password was changed. If this was not you, please contact support."
    );
    expect(result.category).toBe("security");
    expect(result.level).toBe("high");
  });

  it("classifies system sender without security keywords as system/low", () => {
    const result = summarizeInboundUnknownEmail(
      "noreply@service.example.com",
      "Your order has shipped",
      "Your package is on the way."
    );
    expect(result.category).toBe("system");
    expect(result.level).toBe("low");
  });

  it("classifies general unknown sender as general/medium", () => {
    const result = summarizeInboundUnknownEmail(
      "somebody@example.com",
      "Hello there",
      "Just wanted to reach out."
    );
    expect(result.category).toBe("general");
    expect(result.level).toBe("medium");
  });

  it("includes from address and subject in summary", () => {
    const result = summarizeInboundUnknownEmail(
      "test@example.com",
      "Test Subject",
      "Test body"
    );
    expect(result.summary).toContain("test@example.com");
    expect(result.summary).toContain("Test Subject");
  });
});

