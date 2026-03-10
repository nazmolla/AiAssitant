import {
  createOverlapGuard,
  shouldRunEveningMaintenance,
  type EveningSchedule,
} from "@/lib/knowledge-maintenance/schedule";

describe("knowledge maintenance schedule", () => {
  const schedule: EveningSchedule = { hour: 20, minute: 0 };

  test("does not run before evening window", () => {
    const now = new Date("2026-03-10T19:59:00");
    expect(shouldRunEveningMaintenance(now, null, schedule)).toBe(false);
  });

  test("runs once when evening window starts", () => {
    const now = new Date("2026-03-10T20:00:00");
    expect(shouldRunEveningMaintenance(now, null, schedule)).toBe(true);
  });

  test("does not run again if already run today", () => {
    const now = new Date("2026-03-10T22:00:00");
    expect(shouldRunEveningMaintenance(now, "2026-03-10", schedule)).toBe(false);
  });
});

describe("knowledge maintenance overlap guard", () => {
  test("skips overlapping runs", async () => {
    const guarded = createOverlapGuard();

    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = guarded(async () => {
      await blocker;
    });

    const second = await guarded(async () => {
      throw new Error("should not run");
    });

    expect(second).toBe(false);
    release();
    await first;
  });
});
