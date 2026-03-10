/**
 * Unit tests for the scheduler config API route.
 */
import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import { getAppConfig, setAppConfig } from "@/lib/db/queries";
import { getDb } from "@/lib/db/connection";

// Mock auth
jest.mock("@/lib/auth", () => ({
  requireAdmin: jest.fn(() => ({ userId: "admin-1" })),
}));

import { GET, PUT } from "@/app/api/config/scheduler/route";

describe("Scheduler config API route", () => {
  beforeAll(() => {
    setupTestDb();
  });

  afterAll(() => {
    teardownTestDb();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("GET returns default schedule when none is set", async () => {
    const res = await GET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.cron_schedule).toBe("*/15 * * * *");
    expect(data.knowledge_maintenance).toEqual({
      enabled: true,
      hour: 20,
      minute: 0,
      poll_seconds: 60,
    });
  });

  test("GET returns stored schedule", async () => {
    setAppConfig("proactive_cron_schedule", "*/5 * * * *");
    const res = await GET();
    const data = await res.json();
    expect(data.cron_schedule).toBe("*/5 * * * *");
  });

  test("PUT updates schedule and syncs unified scheduler records", async () => {
    const req = new Request("http://localhost/api/config/scheduler", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cron_schedule: "*/30 * * * *",
        knowledge_maintenance: {
          enabled: false,
          hour: 21,
          minute: 30,
          poll_seconds: 90,
        },
      }),
    });
    const res = await PUT(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.cron_schedule).toBe("*/30 * * * *");
    expect(data.knowledge_maintenance).toEqual({
      enabled: false,
      hour: 21,
      minute: 30,
      poll_seconds: 90,
    });
    expect(getAppConfig("proactive_cron_schedule")).toBe("*/30 * * * *");
    expect(getAppConfig("knowledge_maintenance_enabled")).toBe("0");
    expect(getAppConfig("knowledge_maintenance_hour")).toBe("21");
    expect(getAppConfig("knowledge_maintenance_minute")).toBe("30");
    expect(getAppConfig("knowledge_maintenance_poll_seconds")).toBe("90");

    const db = getDb();
    const proactive = db.prepare("SELECT trigger_type, trigger_expr, status FROM scheduler_schedules WHERE schedule_key = 'system.proactive.scan'").get() as {
      trigger_type: string;
      trigger_expr: string;
      status: string;
    } | undefined;
    expect(proactive).toBeDefined();
    expect(proactive?.trigger_type).toBe("interval");
    expect(proactive?.trigger_expr).toBe("every:30:minute");
    expect(proactive?.status).toBe("active");

    const knowledge = db.prepare("SELECT trigger_expr, status FROM scheduler_schedules WHERE schedule_key = 'system.knowledge_maintenance.run_due'").get() as {
      trigger_expr: string;
      status: string;
    } | undefined;
    expect(knowledge).toBeDefined();
    expect(knowledge?.trigger_expr).toBe("every:90:second");
    expect(knowledge?.status).toBe("paused");
  });

  test("PUT rejects invalid cron expression", async () => {
    const req = new Request("http://localhost/api/config/scheduler", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cron_schedule: "not a cron" }),
    });
    const res = await PUT(req);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("Invalid cron");
  });

  test("PUT rejects empty cron expression", async () => {
    const req = new Request("http://localhost/api/config/scheduler", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cron_schedule: "" }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });
});
