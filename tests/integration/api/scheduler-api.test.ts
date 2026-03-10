import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";

installAuthMocks();

import { NextRequest } from "next/server";
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { GET as GET_OVERVIEW } from "@/app/api/scheduler/overview/route";
import { GET as GET_HEALTH } from "@/app/api/scheduler/health/route";
import { GET as GET_SCHEDULES } from "@/app/api/scheduler/schedules/route";
import { DELETE as DELETE_SCHEDULE, GET as GET_SCHEDULE, PUT as PUT_SCHEDULE } from "@/app/api/scheduler/schedules/[id]/route";
import { POST as POST_PAUSE } from "@/app/api/scheduler/schedules/[id]/pause/route";
import { POST as POST_RESUME } from "@/app/api/scheduler/schedules/[id]/resume/route";
import { POST as POST_TRIGGER } from "@/app/api/scheduler/schedules/[id]/trigger/route";
import { PATCH as PATCH_TASKS } from "@/app/api/scheduler/schedules/[id]/tasks/route";
import { GET as GET_RUNS } from "@/app/api/scheduler/runs/route";
import { GET as GET_RUN } from "@/app/api/scheduler/runs/[id]/route";
import { getDb } from "@/lib/db/connection";

let adminId: string;
let userId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "admin-scheduler@test.com", role: "admin" });
  userId = seedTestUser({ email: "user-scheduler@test.com", role: "user" });

  const db = getDb();
  db.prepare(
    `INSERT INTO scheduler_schedules (
      id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr, timezone, status, max_concurrency, misfire_policy, next_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?, datetime('now', '+10 minutes'))`
  ).run(
    "sched-api-1",
    "api.test.1",
    "API Test Schedule",
    "user",
    adminId,
    "agent.prompt",
    "interval",
    "every:1:hour",
    "active",
    1,
    "run_immediately"
  );

  db.prepare(
    `INSERT INTO scheduler_tasks (
      id, schedule_id, task_key, name, handler_name, execution_mode, sequence_no, enabled, config_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "sched-task-api-1",
    "sched-api-1",
    "primary",
    "Primary Task",
    "agent.prompt",
    "sync",
    0,
    1,
    JSON.stringify({ prompt: "Scheduled task: API Test", userId: adminId, threadId: "thread-api-1" })
  );
});

afterAll(() => {
  teardownTestDb();
});

describe("scheduler API auth", () => {
  test("returns 401 for unauthenticated calls", async () => {
    setMockUser(null);
    const res = await GET_OVERVIEW(new NextRequest("http://localhost/api/scheduler/overview"));
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin user", async () => {
    setMockUser({ id: userId, email: "user-scheduler@test.com", role: "user" });
    const res = await GET_OVERVIEW(new NextRequest("http://localhost/api/scheduler/overview"));
    expect(res.status).toBe(403);
  });
});

describe("scheduler API endpoints", () => {
  beforeEach(() => {
    setMockUser({ id: adminId, email: "admin-scheduler@test.com", role: "admin" });
  });

  test("GET overview returns stats payload", async () => {
    const res = await GET_OVERVIEW(new NextRequest("http://localhost/api/scheduler/overview"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("schedules_total");
    expect(body).toHaveProperty("recent_runs");
  });

  test("GET health returns metrics and warning hooks", async () => {
    const res = await GET_HEALTH(new NextRequest("http://localhost/api/scheduler/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("metrics");
    expect(body).toHaveProperty("warnings");
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body).toHaveProperty("status");
  });

  test("GET schedules returns paginated data", async () => {
    const res = await GET_SCHEDULES(new NextRequest("http://localhost/api/scheduler/schedules?limit=10&offset=0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  test("GET schedule detail returns schedule, tasks, recent_runs", async () => {
    const res = await GET_SCHEDULE(new NextRequest("http://localhost/api/scheduler/schedules/sched-api-1"), { params: Promise.resolve({ id: "sched-api-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schedule.id).toBe("sched-api-1");
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(Array.isArray(body.recent_runs)).toBe(true);
  });

  test("pause and resume schedule", async () => {
    const pauseRes = await POST_PAUSE(new NextRequest("http://localhost/api/scheduler/schedules/sched-api-1/pause", { method: "POST" }), { params: Promise.resolve({ id: "sched-api-1" }) });
    expect(pauseRes.status).toBe(200);

    const resumeRes = await POST_RESUME(new NextRequest("http://localhost/api/scheduler/schedules/sched-api-1/resume", { method: "POST" }), { params: Promise.resolve({ id: "sched-api-1" }) });
    expect(resumeRes.status).toBe(200);
  });

  test("trigger creates queued run and tasks", async () => {
    const triggerRes = await POST_TRIGGER(new NextRequest("http://localhost/api/scheduler/schedules/sched-api-1/trigger", { method: "POST" }), { params: Promise.resolve({ id: "sched-api-1" }) });
    expect(triggerRes.status).toBe(200);
    const body = await triggerRes.json();
    expect(body).toHaveProperty("run_id");

    const runsRes = await GET_RUNS(new NextRequest("http://localhost/api/scheduler/runs?scheduleId=sched-api-1"));
    expect(runsRes.status).toBe(200);
    const runsBody = await runsRes.json();
    expect(runsBody.total).toBeGreaterThanOrEqual(1);

    const runRes = await GET_RUN(new NextRequest(`http://localhost/api/scheduler/runs/${body.run_id}`), { params: Promise.resolve({ id: body.run_id }) });
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json();
    expect(runBody.run.id).toBe(body.run_id);
  });

  test("tasks patch updates task graph", async () => {
    const req = new NextRequest("http://localhost/api/scheduler/schedules/sched-api-1/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: [
          {
            id: "sched-task-api-1",
            task_key: "primary",
            name: "Primary Task Updated",
            handler_name: "agent.prompt",
            execution_mode: "sync",
            sequence_no: 0,
            enabled: 1,
            config_json: { prompt: "Scheduled task: API Test", userId: adminId, threadId: "thread-api-1" },
          },
        ],
      }),
    });

    const res = await PATCH_TASKS(req, { params: Promise.resolve({ id: "sched-api-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.tasks[0].name).toBe("Primary Task Updated");
  });

  test("PUT schedule updates schedule metadata", async () => {
    const req = new NextRequest("http://localhost/api/scheduler/schedules/sched-api-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "API Test Schedule Updated",
        trigger_type: "interval",
        trigger_expr: "every:2:hour",
      }),
    });

    const res = await PUT_SCHEDULE(req, { params: Promise.resolve({ id: "sched-api-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schedule.name).toBe("API Test Schedule Updated");
    expect(body.schedule.trigger_expr).toBe("every:2:hour");
  });

  test("tasks patch supports replace mode for removals", async () => {
    const req = new NextRequest("http://localhost/api/scheduler/schedules/sched-api-1/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        replace: true,
        tasks: [
          {
            task_key: "replacement",
            name: "Replacement Task",
            handler_name: "agent.prompt",
            execution_mode: "sync",
            sequence_no: 0,
            enabled: 1,
          },
        ],
      }),
    });

    const res = await PATCH_TASKS(req, { params: Promise.resolve({ id: "sched-api-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks.length).toBe(1);
    expect(body.tasks[0].task_key).toBe("replacement");
  });

  test("DELETE schedule removes schedule and cascading records", async () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO scheduler_schedules (
        id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr, timezone, status, max_concurrency, misfire_policy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UTC', ?, ?, ?)`
    ).run(
      "sched-api-delete",
      "api.test.delete",
      "Delete Schedule",
      "user",
      adminId,
      "agent.prompt",
      "interval",
      "every:1:day",
      "active",
      1,
      "run_immediately"
    );
    db.prepare(
      `INSERT INTO scheduler_tasks (
        id, schedule_id, task_key, name, handler_name, execution_mode, sequence_no, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "sched-task-delete-1",
      "sched-api-delete",
      "delete_task",
      "Delete Task",
      "agent.prompt",
      "sync",
      0,
      1
    );

    const res = await DELETE_SCHEDULE(
      new NextRequest("http://localhost/api/scheduler/schedules/sched-api-delete", { method: "DELETE" }),
      { params: Promise.resolve({ id: "sched-api-delete" }) }
    );
    expect(res.status).toBe(200);

    const scheduleCount = db.prepare("SELECT COUNT(*) AS c FROM scheduler_schedules WHERE id = ?").get("sched-api-delete") as { c: number };
    const taskCount = db.prepare("SELECT COUNT(*) AS c FROM scheduler_tasks WHERE schedule_id = ?").get("sched-api-delete") as { c: number };
    expect(scheduleCount.c).toBe(0);
    expect(taskCount.c).toBe(0);
  });
});
