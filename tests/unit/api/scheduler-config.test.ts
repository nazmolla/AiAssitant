/**
 * Unit tests for the scheduler config API route.
 */
import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import { getAppConfig, setAppConfig } from "@/lib/db/queries";

// Mock auth
jest.mock("@/lib/auth", () => ({
  requireAdmin: jest.fn(() => ({ userId: "admin-1" })),
}));

// Mock restartScheduler
jest.mock("@/lib/scheduler", () => ({
  restartScheduler: jest.fn(),
}));

import { GET, PUT } from "@/app/api/config/scheduler/route";
import { restartScheduler } from "@/lib/scheduler";

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
  });

  test("GET returns stored schedule", async () => {
    setAppConfig("proactive_cron_schedule", "*/5 * * * *");
    const res = await GET();
    const data = await res.json();
    expect(data.cron_schedule).toBe("*/5 * * * *");
  });

  test("PUT updates schedule and restarts scheduler", async () => {
    const req = new Request("http://localhost/api/config/scheduler", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cron_schedule: "*/30 * * * *" }),
    });
    const res = await PUT(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.cron_schedule).toBe("*/30 * * * *");
    expect(getAppConfig("proactive_cron_schedule")).toBe("*/30 * * * *");
    expect(restartScheduler).toHaveBeenCalled();
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
