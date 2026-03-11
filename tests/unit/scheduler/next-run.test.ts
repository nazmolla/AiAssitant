import { computeSchedulerNextRunAt, isValidSchedulerIntervalExpr, normalizeSchedulerIntervalExpr } from "@/lib/scheduler/next-run";

describe("scheduler next-run helpers", () => {
  test("normalizes lenient interval expressions", () => {
    expect(normalizeSchedulerIntervalExpr("every:10minute")).toBe("every:10:minute");
    expect(normalizeSchedulerIntervalExpr("every 5 hours")).toBe("every:5:hour");
    expect(normalizeSchedulerIntervalExpr("3 day")).toBe("every:3:day");
  });

  test("rejects invalid interval expressions", () => {
    expect(normalizeSchedulerIntervalExpr("every:minute")).toBeNull();
    expect(normalizeSchedulerIntervalExpr("*/5 * * * *")).toBeNull();
    expect(isValidSchedulerIntervalExpr("every:minute")).toBe(false);
  });

  test("computes next run for normalized interval expression", () => {
    const result = computeSchedulerNextRunAt("interval", "every:2hour");
    expect(typeof result === "string" || result === null).toBe(true);
    expect(result).not.toBeNull();
  });
});
