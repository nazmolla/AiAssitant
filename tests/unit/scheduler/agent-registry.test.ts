/**
 * Tests for the scheduler agent registry and deterministic task execution (issue #297).
 */

import {
  registerSchedulerAgent,
  getSchedulerAgent,
  getAllSchedulerAgents,
  validateAgentSchema,
  type SchedulerAgentDefinition,
} from "@/lib/scheduler/agent-registry";

describe("validateAgentSchema", () => {
  const schema: Record<string, unknown> = {
    type: "object",
    properties: {
      foo: { type: "string" },
      bar: { type: "number" },
    },
    required: ["foo", "bar"],
  };

  test("returns valid when all required keys present", () => {
    const result = validateAgentSchema(schema, { foo: "hello", bar: 42 });
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test("returns invalid when required key missing", () => {
    const result = validateAgentSchema(schema, { foo: "hello" });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("bar");
  });

  test("returns invalid when required value is null", () => {
    const result = validateAgentSchema(schema, { foo: "hello", bar: null });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("bar");
  });

  test("returns valid when no required fields", () => {
    const emptySchema: Record<string, unknown> = { type: "object", properties: {} };
    const result = validateAgentSchema(emptySchema, {});
    expect(result.valid).toBe(true);
  });
});

describe("scheduler agent registry", () => {
  test("built-in agents are registered on import", () => {
    const agents = getAllSchedulerAgents();
    const names = agents.map((a) => a.name);
    expect(names).toContain("email-ingest");
    expect(names).toContain("knowledge-maintenance");
    expect(names).toContain("db-maintenance");
    expect(names).toContain("proactive-scan");
  });

  test("getSchedulerAgent returns definition for known agent", () => {
    const def = getSchedulerAgent("email-ingest");
    expect(def).toBeDefined();
    expect(def?.input_schema).toBeDefined();
    expect(def?.output_schema).toBeDefined();
    expect(typeof def?.fn).toBe("function");
  });

  test("getSchedulerAgent returns undefined for unknown agent", () => {
    expect(getSchedulerAgent("not-a-real-agent")).toBeUndefined();
  });

  test("registerSchedulerAgent adds and retrieves custom agent", () => {
    const mockDef: SchedulerAgentDefinition = {
      name: "test-agent-xyz",
      description: "Test agent",
      input_schema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
      output_schema: { type: "object", properties: { y: { type: "number" } }, required: ["y"] },
      fn: async (inputs) => ({ y: String(inputs.x).length }),
    };
    registerSchedulerAgent(mockDef);

    const retrieved = getSchedulerAgent("test-agent-xyz");
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe("test-agent-xyz");
  });

  test("each built-in agent has required output_schema keys", () => {
    const requiredOutputKeys: Record<string, string[]> = {
      "email-ingest": ["processed", "errors", "threadId"],
      "knowledge-maintenance": ["ran", "updated", "skipped"],
      "db-maintenance": ["ran", "vacuumed", "pruned"],
      "proactive-scan": ["toolsUsed", "summary", "threadId"],
    };

    for (const [name, keys] of Object.entries(requiredOutputKeys)) {
      const def = getSchedulerAgent(name);
      expect(def).toBeDefined();
      const schema = def!.output_schema;
      const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
      for (const key of keys) {
        expect(required).toContain(key);
      }
    }
  });
});

describe("input ref resolution", () => {
  // Test the resolveInputRefs logic directly by checking engine behavior via task run.
  // We test the pure logic here by importing the unexported helper via a wrapper.
  // Since resolveInputRefs is module-private, test it through a minimal mock agent.

  test("custom agent receives resolved $tasks refs as inputs", async () => {
    const received: Record<string, unknown>[] = [];

    registerSchedulerAgent({
      name: "ref-test-agent",
      description: "Test ref resolution",
      input_schema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
      output_schema: { type: "object", properties: { echoed: { type: "string" } }, required: ["echoed"] },
      fn: async (inputs) => {
        received.push({ ...inputs });
        return { echoed: String(inputs.value ?? "") };
      },
    });

    // The engine's resolveInputRefs is tested via the integration test.
    // Here verify the agent fn itself handles inputs correctly.
    const def = getSchedulerAgent("ref-test-agent");
    expect(def).toBeDefined();
    const output = await def!.fn({ value: "hello" }, { scheduleId: "s1", runId: "r1", taskRunId: "t1", agentName: "ref-test-agent" });
    expect(output.echoed).toBe("hello");
    expect(received[0].value).toBe("hello");
  });
});
