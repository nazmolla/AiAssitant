/**
 * Integration tests — Alexa Config API (/api/config/alexa)
 *
 * Tests auth, admin-only access, GET (masked creds), and PUT (encrypted storage).
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

jest.mock("@/lib/db/queries", () => {
  const store = new Map<string, string>();
  return {
    getAppConfig: jest.fn((key: string) => store.get(key)),
    setAppConfig: jest.fn((key: string, val: string) => { store.set(key, val); }),
    __store: store,
  };
});

jest.mock("@/lib/db/crypto", () => ({
  encryptField: jest.fn((v: string) => `ENC:${v}`),
  decryptField: jest.fn((v: string) => v.startsWith("ENC:") ? v.slice(4) : null),
}));

import { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/config/alexa/route";

let adminId: string;
let userId: string;

beforeAll(() => {
  adminId = "admin-alexa-1";
  userId = "user-alexa-1";
});

beforeEach(() => {
  jest.clearAllMocks();
  const { __store } = require("@/lib/db/queries");
  __store.clear();
});

describe("GET /api/config/alexa", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin users", async () => {
    setMockUser({ id: userId, email: "user@test.com", role: "user" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("returns configured: false when no creds stored", async () => {
    setMockUser({ id: adminId, email: "admin@test.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.configured).toBe(false);
    expect(data.ubidMain).toBe("");
    expect(data.atMain).toBe("");
  });

  test("returns masked credentials when configured", async () => {
    setMockUser({ id: adminId, email: "admin@test.com", role: "admin" });

    // Store credentials first
    const { __store } = require("@/lib/db/queries");
    __store.set("alexa.ubid_main", "ENC:abcdef1234567890");
    __store.set("alexa.at_main", "ENC:Atza|longtoken1234567890abcdef");

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.configured).toBe(true);
    // Masked: first 6 chars + ••• + last 4 chars for ubid
    expect(data.ubidMain).toContain("•••");
    expect(data.ubidMain.startsWith("abcdef")).toBe(true);
    // Masked: first 8 chars + ••• + last 4 chars for atMain
    expect(data.atMain).toContain("•••");
  });
});

describe("PUT /api/config/alexa", () => {
  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const req = new NextRequest("http://localhost/api/config/alexa", {
      method: "PUT",
      body: JSON.stringify({ ubidMain: "ubid", atMain: "at" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin users", async () => {
    setMockUser({ id: userId, email: "user@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/config/alexa", {
      method: "PUT",
      body: JSON.stringify({ ubidMain: "ubid", atMain: "at" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(403);
  });

  test("returns 400 when ubidMain is missing", async () => {
    setMockUser({ id: adminId, email: "admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/alexa", {
      method: "PUT",
      body: JSON.stringify({ atMain: "at-value" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("required");
  });

  test("returns 400 when atMain is missing", async () => {
    setMockUser({ id: adminId, email: "admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/alexa", {
      method: "PUT",
      body: JSON.stringify({ ubidMain: "ubid-value" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  test("saves encrypted credentials and returns ok", async () => {
    setMockUser({ id: adminId, email: "admin@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/config/alexa", {
      method: "PUT",
      body: JSON.stringify({ ubidMain: " ubid-value-123 ", atMain: " at-value-456 " }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    // Verify encrypted storage
    const { setAppConfig } = require("@/lib/db/queries");
    expect(setAppConfig).toHaveBeenCalledWith("alexa.ubid_main", "ENC:ubid-value-123");
    expect(setAppConfig).toHaveBeenCalledWith("alexa.at_main", "ENC:at-value-456");
  });
});
