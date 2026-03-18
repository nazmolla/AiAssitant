import { setupTestDb, teardownTestDb } from "../../helpers/test-db";

describe("scheduler delete persistence", () => {
  beforeEach(() => {
    jest.resetModules();
    setupTestDb();
  });

  afterEach(() => {
    teardownTestDb();
  });

  test("deleteSchedulerScheduleById records suppressed schedule key", () => {
    const { initializeDatabase } = require("@/lib/db/init");
    const { getDb } = require("@/lib/db/connection");
    const { deleteSchedulerScheduleById } = require("@/lib/db/scheduler-queries");

    initializeDatabase();
    const db = getDb();
    const existing = db.prepare("SELECT id FROM scheduler_schedules WHERE schedule_key = ?").get("workflow.job_scout.pipeline") as { id: string } | undefined;
    expect(existing).not.toBeNull();

    const deleted = deleteSchedulerScheduleById(existing.id);
    expect(deleted).toBe(1);

    const row = db.prepare("SELECT value FROM app_config WHERE key = 'scheduler.suppressed_schedule_keys'").get() as { value?: string } | undefined;
    expect(row?.value).toBeTruthy();

    const keys = JSON.parse(String(row?.value || "[]")) as string[];
    expect(keys).toContain("workflow.job_scout.pipeline");
  });
});
