/**
 * Integration tests — LLM Config API (/api/config/llm)
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, POST, PATCH, DELETE } from "@/app/api/config/llm/route";

let adminId: string;
let userId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "llm-admin@example.com", role: "admin" });
  userId = seedTestUser({ email: "llm-user@example.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/config/llm", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin", async () => {
    setMockUser({ id: userId, email: "llm-user@example.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("returns empty list for admin", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });
});

describe("POST /api/config/llm", () => {
  test("returns 400 without label", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/llm", {
      method: "POST",
      body: JSON.stringify({ provider_type: "openai", config: { apiKey: "sk-test" } }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid provider_type", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/llm", {
      method: "POST",
      body: JSON.stringify({
        label: "Test",
        provider_type: "invalid",
        config: { apiKey: "sk-test" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("creates an OpenAI provider", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/llm", {
      method: "POST",
      body: JSON.stringify({
        label: "GPT-4o",
        provider_type: "openai",
        purpose: "chat",
        config: { apiKey: "sk-test-key-12345", model: "gpt-4o" },
        is_default: true,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.label).toBe("GPT-4o");
    expect(data.provider_type).toBe("openai");
    expect(data.is_default).toBe(true);
    // API key should be redacted
    expect(data.config.apiKey).toBe("••••••");
    expect(data.has_api_key).toBe(true);
  });

  test("creates an Anthropic provider", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/llm", {
      method: "POST",
      body: JSON.stringify({
        label: "Claude Sonnet",
        provider_type: "anthropic",
        purpose: "chat",
        config: { apiKey: "sk-ant-test", model: "claude-sonnet-4-20250514" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  test("creates a TTS-purpose OpenAI provider", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/llm", {
      method: "POST",
      body: JSON.stringify({
        label: "TTS Provider",
        provider_type: "openai",
        purpose: "tts",
        config: { apiKey: "sk-audio-key" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.purpose).toBe("tts");
  });

  test("creates an STT-purpose Azure provider with deployment", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/llm", {
      method: "POST",
      body: JSON.stringify({
        label: "Azure STT",
        provider_type: "azure-openai",
        purpose: "stt",
        config: {
          apiKey: "azure-audio-key",
          endpoint: "https://my-resource.openai.azure.com",
          deployment: "whisper",
        },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.purpose).toBe("stt");
    expect(data.provider_type).toBe("azure-openai");
  });

  test("returns 400 for invalid purpose", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/llm", {
      method: "POST",
      body: JSON.stringify({
        label: "Bad Purpose",
        provider_type: "openai",
        purpose: "invalid",
        config: { apiKey: "sk-test" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("purpose");
  });

  test("returns 400 for Azure OpenAI without endpoint", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/llm", {
      method: "POST",
      body: JSON.stringify({
        label: "Azure",
        provider_type: "azure-openai",
        config: { apiKey: "test" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("endpoint");
  });

  test("provider list shows redacted keys", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const res = await GET();
    const data = await res.json();
    expect(data.length).toBe(4);
    data.forEach((p: any) => {
      expect(p.config.apiKey).toBe("••••••");
    });
  });
});

describe("PATCH /api/config/llm", () => {
  let providerId: string;

  beforeAll(async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const list = await GET();
    const data = await list.json();
    providerId = data[0].id;
  });

  test("returns 400 without id", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/llm", {
      method: "PATCH",
      body: JSON.stringify({ label: "Updated" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  test("updates provider label", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/llm", {
      method: "PATCH",
      body: JSON.stringify({ id: providerId, label: "GPT-4o Updated" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.label).toBe("GPT-4o Updated");
  });

  test("returns 404 for non-existent provider", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/llm", {
      method: "PATCH",
      body: JSON.stringify({ id: "no-such-id", label: "X" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/config/llm", () => {
  test("returns 400 without id", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/llm", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  test("deletes a provider", async () => {
    setMockUser({ id: adminId, email: "llm-admin@example.com", role: "admin" });
    const list = await GET();
    const data = await list.json();
    const id = data[0].id;

    const req = new NextRequest(`http://localhost/api/config/llm?id=${id}`, { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
