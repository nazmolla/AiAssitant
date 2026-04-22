/**
 * Unit tests — checkRisk() risk gate
 *
 * Validates that the stateless risk gate correctly approves or blocks
 * trades based on position size, daily loss cap, and paper-mode guard.
 */

import { checkRisk, type RiskCheckInput } from "@/lib/integrations/alpaca";

const BASE: RiskCheckInput = {
  proposedNotional: 20,
  portfolioEquity: 100,
  maxPositionPct: 0.20,
  todayLossUsd: 0,
  dailyLossCapUsd: 10,
  isLiveMode: false,
};

describe("checkRisk — approved cases", () => {
  it("approves a valid paper trade within position limit", () => {
    const result = checkRisk(BASE);
    expect(result.approved).toBe(true);
  });

  it("approves exactly at the position limit boundary", () => {
    const result = checkRisk({ ...BASE, proposedNotional: 20, portfolioEquity: 100, maxPositionPct: 0.20 });
    expect(result.approved).toBe(true);
  });

  it("approves with zero today loss", () => {
    const result = checkRisk({ ...BASE, todayLossUsd: 0 });
    expect(result.approved).toBe(true);
  });

  it("approves live mode when allowLiveInTest is set", () => {
    const result = checkRisk({ ...BASE, isLiveMode: true, allowLiveInTest: true });
    expect(result.approved).toBe(true);
  });
});

describe("checkRisk — blocked: live mode guard", () => {
  it("blocks live trade without test override", () => {
    const result = checkRisk({ ...BASE, isLiveMode: true });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/live trading is disabled/i);
  });
});

describe("checkRisk — blocked: daily loss cap", () => {
  it("blocks when today loss equals cap", () => {
    const result = checkRisk({ ...BASE, todayLossUsd: 10, dailyLossCapUsd: 10 });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/daily loss cap/i);
  });

  it("blocks when today loss exceeds cap", () => {
    const result = checkRisk({ ...BASE, todayLossUsd: 12, dailyLossCapUsd: 10 });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/daily loss cap/i);
  });

  it("approves just below cap", () => {
    const result = checkRisk({ ...BASE, todayLossUsd: 9.99, dailyLossCapUsd: 10 });
    expect(result.approved).toBe(true);
  });
});

describe("checkRisk — blocked: position size", () => {
  it("blocks when proposed notional exceeds max allowed", () => {
    // maxAllowed = 100 * 0.20 = $20; proposedNotional = $21 → blocked
    const result = checkRisk({ ...BASE, proposedNotional: 21, portfolioEquity: 100, maxPositionPct: 0.20 });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/position size/i);
  });

  it("blocks at 10% limit with oversized order", () => {
    // maxAllowed = 100 * 0.10 = $10; proposedNotional = $15 → blocked
    const result = checkRisk({ ...BASE, proposedNotional: 15, portfolioEquity: 100, maxPositionPct: 0.10 });
    expect(result.approved).toBe(false);
  });

  it("approves at 20% limit with $50 equity and $10 order", () => {
    const result = checkRisk({ ...BASE, proposedNotional: 10, portfolioEquity: 50, maxPositionPct: 0.20 });
    expect(result.approved).toBe(true);
  });
});

describe("checkRisk — reason text", () => {
  it("approved reason is user-friendly", () => {
    const result = checkRisk(BASE);
    expect(result.reason).toBe("Risk checks passed.");
  });

  it("blocked reason includes dollar amounts", () => {
    const result = checkRisk({ ...BASE, proposedNotional: 30, portfolioEquity: 100, maxPositionPct: 0.20 });
    expect(result.reason).toContain("$30");
    expect(result.reason).toContain("$20");
  });
});
