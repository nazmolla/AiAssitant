import { checkTradeRisk, type TradingRisk } from "@/lib/integrations/kraken";

function makeRisk(overrides: Partial<TradingRisk> = {}): TradingRisk {
  return {
    balanceUsd: 500,
    maxPositionPct: 0.25,
    stopLossPct: 0.10,
    dailyLossCapUsd: 50,
    minTradeUsd: 10,
    ...overrides,
  };
}

describe("checkTradeRisk", () => {
  test("approves a valid trade", () => {
    const result = checkTradeRisk(50, 0, makeRisk());
    expect(result.approved).toBe(true);
  });

  test("blocks when balance is below minimum trade size", () => {
    const result = checkTradeRisk(10, 0, makeRisk({ balanceUsd: 5 }));
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("minimum trade size");
  });

  test("blocks when daily loss cap is reached", () => {
    const result = checkTradeRisk(20, 50, makeRisk({ dailyLossCapUsd: 50 }));
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Daily loss cap");
  });

  test("blocks when daily loss exceeds cap", () => {
    const result = checkTradeRisk(20, 60, makeRisk({ dailyLossCapUsd: 50 }));
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Daily loss cap");
  });

  test("blocks when proposed volume exceeds max position pct", () => {
    // balance=$500, maxPositionPct=25% → max=$125; propose $200
    const result = checkTradeRisk(200, 0, makeRisk({ balanceUsd: 500, maxPositionPct: 0.25 }));
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("exceeds max");
  });

  test("blocks when proposed volume is below minimum trade size", () => {
    const result = checkTradeRisk(5, 0, makeRisk());
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("below Kraken minimum");
  });

  test("approves exactly at max position pct boundary", () => {
    // balance=$500, maxPositionPct=25% → max=$125; propose exactly $125
    const result = checkTradeRisk(125, 0, makeRisk({ balanceUsd: 500, maxPositionPct: 0.25 }));
    expect(result.approved).toBe(true);
  });

  test("checks balance check before daily loss cap", () => {
    // balance below min → balance check triggers first
    const result = checkTradeRisk(10, 60, makeRisk({ balanceUsd: 5, dailyLossCapUsd: 50 }));
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("minimum trade size");
  });

  test("reason string is always non-empty", () => {
    const approved = checkTradeRisk(50, 0, makeRisk());
    const blocked = checkTradeRisk(200, 0, makeRisk());
    expect(approved.reason.length).toBeGreaterThan(0);
    expect(blocked.reason.length).toBeGreaterThan(0);
  });
});
