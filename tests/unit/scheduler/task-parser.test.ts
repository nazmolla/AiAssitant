import { parseScheduledTasksFromUserMessage } from "@/lib/scheduler/task-parser";

describe("task parser", () => {
  test("detects one-time future task", () => {
    const parsed = parseScheduledTasksFromUserMessage("Remind me in 2 hours to check the server logs");
    expect(parsed.length).toBe(1);
    expect(parsed[0].taskName.toLowerCase()).toContain("check the server logs");
    expect(parsed[0].schedule.frequency).toBe("once");
  });

  test("detects recurring daily task", () => {
    const parsed = parseScheduledTasksFromUserMessage("Every day remind me to review pending approvals");
    expect(parsed.length).toBe(1);
    expect(parsed[0].schedule.frequency).toBe("daily");
  });

  test("detects multiple task segments", () => {
    const parsed = parseScheduledTasksFromUserMessage(
      "Schedule tomorrow to send weekly report; every week remind me to archive logs"
    );
    expect(parsed.length).toBeGreaterThanOrEqual(2);
  });

  test("returns empty for plain messages with no schedule intent", () => {
    const parsed = parseScheduledTasksFromUserMessage("What is the weather like today?");
    expect(parsed).toEqual([]);
  });

  test("detects hourly recurring task", () => {
    const parsed = parseScheduledTasksFromUserMessage("Every 2 hours check disk usage");
    expect(parsed.length).toBe(1);
    expect(parsed[0].schedule.frequency).toBe("hourly");
    expect(parsed[0].schedule.intervalValue).toBe(2);
  });

  test("detects weekly recurring task", () => {
    const parsed = parseScheduledTasksFromUserMessage("Weekly remind me to review the backlog");
    expect(parsed.length).toBe(1);
    expect(parsed[0].schedule.frequency).toBe("weekly");
  });

  test("detects monthly recurring task", () => {
    const parsed = parseScheduledTasksFromUserMessage("Monthly remind me to pay the server bill");
    expect(parsed.length).toBe(1);
    expect(parsed[0].schedule.frequency).toBe("monthly");
  });

  test("detects 'in N minutes' one-time task", () => {
    const now = new Date();
    const parsed = parseScheduledTasksFromUserMessage("Remind me in 30 minutes to call support");
    expect(parsed.length).toBe(1);
    expect(parsed[0].schedule.frequency).toBe("once");
    expect(new Date(parsed[0].schedule.nextRunAt).getTime()).toBeGreaterThan(now.getTime());
  });
});
