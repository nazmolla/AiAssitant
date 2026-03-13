import {
  createLlmProviderSchema,
  updateKnowledgeSchema,
  createThreadSchema,
  createUserSchema,
  changePasswordSchema,
  saveLoggingSchema,
} from "@/lib/schemas";
import { validateBody } from "@/lib/validation";
import { envSchema } from "@/lib/env";

describe("Zod schemas", () => {
  describe("envSchema", () => {
    test("accepts valid env with defaults", () => {
      const result = envSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe("development");
        expect(result.data.WORKER_POOL_SIZE).toBe(2);
        expect(result.data.DISABLE_REGISTRATION).toBe(false);
        expect(result.data.PROACTIVE_CRON_SCHEDULE).toBe("*/15 * * * *");
        expect(result.data.NEXUS_DEDUPE_KNOWLEDGE_STARTUP).toBe(false);
      }
    });

    test("coerces DISABLE_REGISTRATION string to boolean", () => {
      const result = envSchema.safeParse({ DISABLE_REGISTRATION: "true" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DISABLE_REGISTRATION).toBe(true);
      }
    });

    test("coerces WORKER_POOL_SIZE string to number", () => {
      const result = envSchema.safeParse({ WORKER_POOL_SIZE: "4" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.WORKER_POOL_SIZE).toBe(4);
      }
    });

    test("clamps WORKER_POOL_SIZE to minimum 1", () => {
      const result = envSchema.safeParse({ WORKER_POOL_SIZE: "-5" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.WORKER_POOL_SIZE).toBeGreaterThanOrEqual(1);
      }
    });

    test("accepts valid NODE_ENV values", () => {
      for (const env of ["development", "production", "test"]) {
        const result = envSchema.safeParse({ NODE_ENV: env });
        expect(result.success).toBe(true);
      }
    });

    test("rejects invalid NODE_ENV", () => {
      const result = envSchema.safeParse({ NODE_ENV: "staging" });
      expect(result.success).toBe(false);
    });
  });

  describe("createLlmProviderSchema", () => {
    test("accepts valid input", () => {
      const result = createLlmProviderSchema.safeParse({
        label: "My Provider",
        provider_type: "openai",
        config: { apiKey: "sk-test" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.label).toBe("My Provider");
        expect(result.data.purpose).toBe("chat"); // default
        expect(result.data.is_default).toBe(false); // default
      }
    });

    test("rejects missing label", () => {
      const result = createLlmProviderSchema.safeParse({
        provider_type: "openai",
        config: { apiKey: "test" },
      });
      expect(result.success).toBe(false);
    });

    test("rejects invalid provider_type", () => {
      const result = createLlmProviderSchema.safeParse({
        label: "Test",
        provider_type: "invalid",
        config: {},
      });
      expect(result.success).toBe(false);
    });

    test("rejects invalid purpose", () => {
      const result = createLlmProviderSchema.safeParse({
        label: "Test",
        provider_type: "openai",
        purpose: "invalid",
        config: {},
      });
      expect(result.success).toBe(false);
    });

    test("trims label whitespace", () => {
      const result = createLlmProviderSchema.safeParse({
        label: "  My Provider  ",
        provider_type: "openai",
        config: {},
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.label).toBe("My Provider");
      }
    });
  });

  describe("updateKnowledgeSchema", () => {
    test("accepts valid input with string id", () => {
      const result = updateKnowledgeSchema.safeParse({
        id: "abc123",
        value: "new value",
      });
      expect(result.success).toBe(true);
    });

    test("accepts valid input with numeric id", () => {
      const result = updateKnowledgeSchema.safeParse({
        id: 42,
        value: "new value",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(42);
      }
    });

    test("rejects missing id", () => {
      const result = updateKnowledgeSchema.safeParse({ value: "test" });
      expect(result.success).toBe(false);
    });

    test("rejects empty string id", () => {
      const result = updateKnowledgeSchema.safeParse({ id: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("createThreadSchema", () => {
    test("accepts empty body", () => {
      const result = createThreadSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test("accepts optional title", () => {
      const result = createThreadSchema.safeParse({ title: "My Thread" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe("My Thread");
      }
    });
  });

  describe("createUserSchema", () => {
    test("accepts valid user", () => {
      const result = createUserSchema.safeParse({
        email: "test@example.com",
        password: "securepass123",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe("user"); // default
      }
    });

    test("rejects invalid email", () => {
      const result = createUserSchema.safeParse({
        email: "not-an-email",
        password: "securepass123",
      });
      expect(result.success).toBe(false);
    });

    test("rejects short password", () => {
      const result = createUserSchema.safeParse({
        email: "test@example.com",
        password: "short",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("changePasswordSchema", () => {
    test("accepts valid input", () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: "oldpass",
        newPassword: "newsecurepass123",
      });
      expect(result.success).toBe(true);
    });

    test("rejects short new password", () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: "oldpass",
        newPassword: "short",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("saveLoggingSchema", () => {
    test("accepts empty body (all optional)", () => {
      const result = saveLoggingSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test("rejects invalid log level", () => {
      const result = saveLoggingSchema.safeParse({ level: "debug" });
      expect(result.success).toBe(false);
    });

    test("rejects negative retention days", () => {
      const result = saveLoggingSchema.safeParse({ retentionDays: -1 });
      expect(result.success).toBe(false);
    });
  });
});

describe("validateBody helper", () => {
  test("returns success with parsed data for valid input", () => {
    const result = validateBody(
      { id: 123, value: "test" },
      updateKnowledgeSchema,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(123);
    }
  });

  test("returns 400 response for invalid input", () => {
    const result = validateBody({}, updateKnowledgeSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const body = result.response;
      expect(body.status).toBe(400);
    }
  });

  test("error response includes field-level details", async () => {
    const result = validateBody({}, updateKnowledgeSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const json = await result.response.json();
      expect(json.error).toBe("Validation failed");
      expect(Array.isArray(json.details)).toBe(true);
      expect(json.details.length).toBeGreaterThan(0);
      expect(json.details[0]).toHaveProperty("field");
      expect(json.details[0]).toHaveProperty("message");
    }
  });
});
