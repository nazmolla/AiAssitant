import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";

installAuthMocks();

import { NextRequest } from "next/server";
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { GET as GET_OVERVIEW } from "@/app/api/scheduler/overview/route";
import { GET as GET_HEALTH } from "@/app/api/scheduler/health/route";
import { GET as GET_SCHEDULES, POST as POST_SCHEDULES } from "@/app/api/scheduler/schedules/route";
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

  test("POST schedules creates independent instances for same batch type", async () => {
    const req1 = new NextRequest("http://localhost/api/scheduler/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch_type: "cleanup",
        name: "Cleanup Batch One",
        trigger_type: "interval",
        trigger_expr: "every:1:day",
      }),
    });
    const req2 = new NextRequest("http://localhost/api/scheduler/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch_type: "cleanup",
        name: "Cleanup Batch Two",
        trigger_type: "interval",
        trigger_expr: "every:1:day",
      }),
    });

    const res1 = await POST_SCHEDULES(req1);
    const res2 = await POST_SCHEDULES(req2);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.schedule_id).toBeDefined();
    expect(body2.schedule_id).toBeDefined();
    expect(body1.schedule_id).not.toBe(body2.schedule_id);
    expect(body1.schedule_key).not.toBe(body2.schedule_key);

    const db = getDb();
    const createdOne = db
      .prepare("SELECT next_run_at FROM scheduler_schedules WHERE id = ?")
      .get(body1.schedule_id) as { next_run_at: string | null } | undefined;
    const createdTwo = db
      .prepare("SELECT next_run_at FROM scheduler_schedules WHERE id = ?")
      .get(body2.schedule_id) as { next_run_at: string | null } | undefined;

    expect(createdOne?.next_run_at).toBeTruthy();
    expect(createdTwo?.next_run_at).toBeTruthy();
  });

  test("POST schedules accepts dedicated email batch type", async () => {
    const req = new NextRequest("http://localhost/api/scheduler/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch_type: "email",
        name: "Email Reader Batch",
        trigger_type: "interval",
        trigger_expr: "every:5:minute",
      }),
    });

    const res = await POST_SCHEDULES(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schedule_id).toBeDefined();

    const db = getDb();
    const task = db
      .prepare("SELECT handler_name FROM scheduler_tasks WHERE schedule_id = ? ORDER BY sequence_no LIMIT 1")
      .get(body.schedule_id) as { handler_name: string } | undefined;
    // Email batch now uses orchestrator-driven single handler
    expect(task?.handler_name).toBe("workflow.email.run");
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
    const db = getDb();
    const before = db
      .prepare("SELECT next_run_at FROM scheduler_schedules WHERE id = ?")
      .get("sched-api-1") as { next_run_at: string | null };

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

    const after = db
      .prepare("SELECT next_run_at FROM scheduler_schedules WHERE id = ?")
      .get("sched-api-1") as { next_run_at: string | null };
    expect(after.next_run_at).toBeTruthy();
    expect(after.next_run_at).not.toBe(before.next_run_at);
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

  test("tasks patch accepts prompt tasks without explicit handler and supports dependency keys", async () => {
    const req = new NextRequest("http://localhost/api/scheduler/schedules/sched-api-1/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        replace: true,
        tasks: [
          {
            task_key: "prompt_1",
            name: "Prompt Task",
            task_type: "prompt",
            prompt: "Run cleanup prompt",
            execution_mode: "sync",
            sequence_no: 0,
            enabled: 1,
          },
          {
            task_key: "followup",
            name: "Followup",
            handler_name: "system.db_maintenance.run_due",
            execution_mode: "sync",
            sequence_no: 1,
            depends_on_task_key: "prompt_1",
            enabled: 1,
          },
        ],
      }),
    });

    const res = await PATCH_TASKS(req, { params: Promise.resolve({ id: "sched-api-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks.length).toBe(2);
    expect(body.tasks[0].handler_name).toBe("agent.prompt");
    expect(body.tasks[1].depends_on_task_id).toBeTruthy();
  });

  test("tasks patch rejects empty tasks when replace is false", async () => {
    const req = new NextRequest("http://localhost/api/scheduler/schedules/sched-api-1/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: [] }),
    });

    const res = await PATCH_TASKS(req, { params: Promise.resolve({ id: "sched-api-1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/must not be empty/i);
  });

  test("tasks patch rejects task missing handler_name", async () => {
    const req = new NextRequest("http://localhost/api/scheduler/schedules/sched-api-1/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: [
          {
            task_key: "invalid",
            name: "Invalid Task",
            execution_mode: "sync",
            sequence_no: 0,
            enabled: 1,
          },
        ],
      }),
    });

    await expect(
      PATCH_TASKS(req, { params: Promise.resolve({ id: "sched-api-1" }) })
    ).rejects.toThrow(/missing handler_name/i);
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

describe("scheduler API: trigger with owner binding (regression for #103, #104)", () => {
  let testUserId: string;

  beforeAll(() => {
    testUserId = seedTestUser({ email: "target-user@test.com", role: "user" });
  });

  test("trigger job scout batch without owner requires user_id parameter", async () => {
    // Create unowned Job Scout schedule (mimics production seeded behavior)
    const db = getDb();
    db.prepare(
      `INSERT INTO scheduler_schedules
        (id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr,
         timezone, status, max_concurrency, misfire_policy, next_run_at)
       VALUES (?, ?, ?, 'system', NULL, 'workflow.job_scout', 'interval', 'every:1:day',
               'UTC', 'active', 1, 'run_immediately', datetime('now', '+1 day'))`
    ).run("sched-unowned-scout", "test.unowned_scout", "Job Scout Unowned");

    db.prepare(
      `INSERT INTO scheduler_tasks
        (id, schedule_id, task_key, name, handler_name, execution_mode, sequence_no, enabled, config_json)
       VALUES (?, ?, ?, ?, ?, 'sync', ?, 1, ?)`
    ).run(
      "task-unowned-search",
      "sched-unowned-scout",
      "run",
      "Job Scout Run",
      "workflow.job_scout.run",
      0,
      JSON.stringify({}),
    );

    // Trigger WITHOUT user_id should fail with 400
    const triggerNoUserIdRes = await POST_TRIGGER(
      new NextRequest("http://localhost/api/scheduler/schedules/sched-unowned-scout/trigger", { method: "POST" }),
      { params: Promise.resolve({ id: "sched-unowned-scout" }) }
    );
    expect(triggerNoUserIdRes.status).toBe(400);
    const errorBody = await triggerNoUserIdRes.json();
    expect(errorBody.error).toContain("user_id");
    expect(errorBody.error).toContain("Job Scout");
  });

  test("trigger job scout batch with user_id binds owner to specified user, not admin", async () => {
    const db = getDb();

    // Create unowned Job Scout schedule
    db.prepare(
      `INSERT INTO scheduler_schedules
        (id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr,
         timezone, status, max_concurrency, misfire_policy, next_run_at)
       VALUES (?, ?, ?, 'system', NULL, 'workflow.job_scout', 'interval', 'every:1:day',
               'UTC', 'active', 1, 'run_immediately', datetime('now', '+1 day'))`
    ).run("sched-owned-scout", "test.owned_scout", "Job Scout With User Binding");

    db.prepare(
      `INSERT INTO scheduler_tasks
        (id, schedule_id, task_key, name, handler_name, execution_mode, sequence_no, enabled, config_json)
       VALUES (?, ?, ?, ?, ?, 'sync', ?, 1, ?)`
    ).run(
      "task-owned-search",
      "sched-owned-scout",
      "run",
      "Job Scout Run",
      "workflow.job_scout.run",
      0,
      JSON.stringify({}),
    );

    // Trigger WITH user_id should succeed and bind owner
    const triggerRes = await POST_TRIGGER(
      new NextRequest("http://localhost/api/scheduler/schedules/sched-owned-scout/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: testUserId }),
      }),
      { params: Promise.resolve({ id: "sched-owned-scout" }) }
    );
    expect(triggerRes.status).toBe(200);
    const triggerBody = await triggerRes.json();
    expect(triggerBody.run_id).toBeDefined();

    // Verify schedule owner_id is now set to testUserId, NOT the admin
    const updatedSchedule = db
      .prepare("SELECT owner_id, owner_type FROM scheduler_schedules WHERE id = ?")
      .get("sched-owned-scout") as { owner_id: string; owner_type: string };

    expect(updatedSchedule.owner_id).toBe(testUserId);
    expect(updatedSchedule.owner_id).not.toBe(adminId); // Must NOT be the triggering admin
    expect(updatedSchedule.owner_type).toBe("user");
  });

  test("trigger pre-owned schedule ignores user_id parameter (backward compatibility)", async () => {
    const db = getDb();

    // Create schedule with admin as owner
    db.prepare(
      `INSERT INTO scheduler_schedules
        (id, schedule_key, name, owner_type, owner_id, handler_type, trigger_type, trigger_expr,
         timezone, status, max_concurrency, misfire_policy, next_run_at)
       VALUES (?, ?, ?, 'user', ?, 'workflow.job_scout', 'interval', 'every:1:day',
               'UTC', 'active', 1, 'run_immediately', datetime('now', '+1 day'))`
    ).run("sched-preowned-scout", "test.preowned_scout", "Job Scout Pre-Owned", adminId);

    db.prepare(
      `INSERT INTO scheduler_tasks
        (id, schedule_id, task_key, name, handler_name, execution_mode, sequence_no, enabled, config_json)
       VALUES (?, ?, ?, ?, ?, 'sync', ?, 1, ?)`
    ).run(
      "task-preowned-search",
      "sched-preowned-scout",
      "run",
      "Job Scout Run",
      "workflow.job_scout.run",
      0,
      JSON.stringify({}),
    );

    // Trigger WITH user_id should succeed but NOT rebind owner (already has owner)
    const triggerRes = await POST_TRIGGER(
      new NextRequest("http://localhost/api/scheduler/schedules/sched-preowned-scout/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: testUserId }),
      }),
      { params: Promise.resolve({ id: "sched-preowned-scout" }) }
    );
    expect(triggerRes.status).toBe(200);

    // Verify owner_id is still adminId (unchanged, not rebound to testUserId)
    const schedule = db
      .prepare("SELECT owner_id FROM scheduler_schedules WHERE id = ?")
      .get("sched-preowned-scout") as { owner_id: string };

    expect(schedule.owner_id).toBe(adminId); // Must remain unchanged
  });
});

describe("scheduler API: batch job creation (Phase 2 — Job Scout workflow)", () => {
    let targetUserId: string;

    beforeAll(() => {
      targetUserId = seedTestUser({ email: "job-scout-target@test.com", role: "user" });
    });

    test("POST /api/scheduler/schedules accepts job_scout batch_type", async () => {
      const req = new NextRequest("http://localhost/api/scheduler/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_type: "job_scout",
          name: "Phase 2 Job Scout Batch",
          trigger_type: "interval",
          trigger_expr: "every:1:day",
        }),
      });

      const res = await POST_SCHEDULES(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.schedule_id).toBeDefined();
      expect(body.schedule_key).toBeDefined();
      expect(body.schedule_key).toMatch(/^batch\.job_scout\./);

      // Verify schedule was created with correct properties
      const db = getDb();
      const schedule = db
        .prepare("SELECT * FROM scheduler_schedules WHERE id = ?")
        .get(body.schedule_id) as any;

      expect(schedule).toBeDefined();
      expect(schedule.name).toBe("Phase 2 Job Scout Batch");
      expect(schedule.handler_type).toBe("batch.job_scout");
      expect(schedule.owner_type).toBe("user");
      expect(schedule.owner_id).toBe(adminId); // Created by admin
    });

    test("Job Scout batch creation includes the single orchestrated task", async () => {
      const req = new NextRequest("http://localhost/api/scheduler/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_type: "job_scout",
          name: "Full Pipeline Test",
          trigger_type: "interval",
          trigger_expr: "every:2:day",
        }),
      });

      const res = await POST_SCHEDULES(req);
      expect(res.status).toBe(200);
      const body = await res.json();

      // Verify all five tasks were created
      const db = getDb();
      const tasks = db
        .prepare(
          `SELECT id, task_key, name, handler_name, sequence_no, depends_on_task_id
           FROM scheduler_tasks
           WHERE schedule_id = ?
           ORDER BY sequence_no ASC`
        )
        .all(body.schedule_id) as any[];

      expect(tasks).toHaveLength(1);

      // Verify task properties
      expect(tasks[0].task_key).toBe("run");
      expect(tasks[0].handler_name).toBe("workflow.job_scout.run");
      expect(tasks[0].depends_on_task_id).toBeNull();
    });

    test("Full user journey: create Job Scout batch, then transfer to target user via trigger", async () => {
      // Step 1: Admin creates Job Scout batch
      const createRes = await POST_SCHEDULES(
        new NextRequest("http://localhost/api/scheduler/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batch_type: "job_scout",
            name: "User Journey Test",
            trigger_type: "interval",
            trigger_expr: "every:1:day",
          }),
        })
      );
      expect(createRes.status).toBe(200);
      const createBody = await createRes.json();
      const scheduleId = createBody.schedule_id;

      const db = getDb();

      // Verify schedule is initially owned by admin
      let schedule = db
        .prepare("SELECT owner_id, owner_type FROM scheduler_schedules WHERE id = ?")
        .get(scheduleId) as { owner_id: string; owner_type: string };
      expect(schedule.owner_id).toBe(adminId);
      expect(schedule.owner_type).toBe("user");

      // Step 2: Manually move to system owner (simulate admin releasing it for target assignment)
      db.prepare("UPDATE scheduler_schedules SET owner_type = ?, owner_id = NULL WHERE id = ?").run(
        "system",
        scheduleId,
      );

      // Step 3: Trigger with user_id to bind to target user
      const triggerRes = await POST_TRIGGER(
        new NextRequest(`http://localhost/api/scheduler/schedules/${scheduleId}/trigger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: targetUserId }),
        }),
        { params: Promise.resolve({ id: scheduleId }) }
      );
      expect(triggerRes.status).toBe(200);
      const triggerBody = await triggerRes.json();
      expect(triggerBody.run_id).toBeDefined();

      // Step 4: Verify schedule is now owned by target user
      schedule = db
        .prepare("SELECT owner_id, owner_type FROM scheduler_schedules WHERE id = ?")
        .get(scheduleId) as { owner_id: string; owner_type: string };
      expect(schedule.owner_id).toBe(targetUserId);
      expect(schedule.owner_type).toBe("user");
      expect(schedule.owner_id).not.toBe(adminId);

      // Step 5: Verify a run was created
      const run = db
        .prepare("SELECT id, schedule_id, status FROM scheduler_runs WHERE id = ?")
        .get(triggerBody.run_id) as any;
      expect(run.schedule_id).toBe(scheduleId);
      expect(run.status).toBe("queued");

      // Step 6: Verify tasks were created for the run
      const taskRuns = db
        .prepare("SELECT COUNT(*) as count FROM scheduler_task_runs WHERE run_id = ?")
        .get(triggerBody.run_id) as { count: number };
      expect(taskRuns.count).toBe(1); // Single orchestrated Job Scout task
    });

    test("Job Scout batch with custom task override", async () => {
      const customPrompt = "Find senior backend engineer roles paying $150k+";
      const req = new NextRequest("http://localhost/api/scheduler/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_type: "job_scout",
          name: "Custom Job Scout",
          trigger_type: "interval",
          trigger_expr: "every:1:day",
          tasks: [
            {
              task_key: "run",
              name: "Job Scout with Custom Context",
              handler_name: "workflow.job_scout.run",
              execution_mode: "sync",
              sequence_no: 0,
              enabled: 1,
              task_type: "prompt",
              prompt: customPrompt,
            },
          ],
        }),
      });

      const res = await POST_SCHEDULES(req);
      expect(res.status).toBe(200);
      const body = await res.json();

      // Verify custom task was used instead of default
      const db = getDb();
      const tasks = db
        .prepare(
          `SELECT task_key, config_json
           FROM scheduler_tasks
           WHERE schedule_id = ?
           ORDER BY sequence_no ASC`
        )
        .all(body.schedule_id) as any[];

      expect(tasks).toHaveLength(1); // Single custom task
      expect(tasks[0].task_key).toBe("run");

      const config = JSON.parse(tasks[0].config_json || "{}");
      expect(config.prompt).toBe(customPrompt);
    });
  });
  });
});
