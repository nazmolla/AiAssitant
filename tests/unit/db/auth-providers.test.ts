/**
 * Unit tests — Auth Providers CRUD
 */
import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import {
  upsertAuthProvider,
  listAuthProviders,
  getAuthProvider,
  getAuthProviderByType,
  getEnabledAuthProviders,
  deleteAuthProvider,
} from "@/lib/db/queries";

beforeAll(() => setupTestDb());
afterAll(() => teardownTestDb());

describe("Auth Providers", () => {
  test("upsertAuthProvider creates Azure AD provider", () => {
    const p = upsertAuthProvider({
      providerType: "azure-ad",
      label: "Azure AD",
      clientId: "client-id-123",
      clientSecret: "secret",
      tenantId: "tenant-id",
    });
    expect(p.id).toBe("azure-ad");
    expect(p.provider_type).toBe("azure-ad");
    expect(p.client_id).toBe("client-id-123");
    expect(p.enabled).toBe(1);
  });

  test("upsertAuthProvider creates Google provider", () => {
    const p = upsertAuthProvider({
      providerType: "google",
      label: "Google",
      clientId: "google-id",
      clientSecret: "google-secret",
    });
    expect(p.id).toBe("google");
  });

  test("upsertAuthProvider creates Discord provider", () => {
    const p = upsertAuthProvider({
      providerType: "discord",
      label: "Discord Bot",
      botToken: "bot-token",
      applicationId: "app-id",
    });
    expect(p.id).toBe("discord");
    expect(p.bot_token).toBe("bot-token");
  });

  test("getAuthProvider retrieves by id", () => {
    const p = getAuthProvider("azure-ad");
    expect(p).toBeDefined();
    expect(p!.tenant_id).toBe("tenant-id");
  });

  test("getAuthProviderByType retrieves by type", () => {
    const p = getAuthProviderByType("google");
    expect(p).toBeDefined();
    expect(p!.client_id).toBe("google-id");
  });

  test("listAuthProviders returns all providers", () => {
    const providers = listAuthProviders();
    expect(providers.length).toBe(3);
  });

  test("getEnabledAuthProviders filters enabled only", () => {
    upsertAuthProvider({ providerType: "google", label: "Google", enabled: false });
    const enabled = getEnabledAuthProviders();
    expect(enabled.find((p) => p.provider_type === "google")).toBeUndefined();
  });

  test("upsertAuthProvider updates on conflict", () => {
    upsertAuthProvider({
      providerType: "azure-ad",
      label: "Azure AD Updated",
      clientId: "new-client",
      clientSecret: "new-secret",
      tenantId: "new-tenant",
    });
    const p = getAuthProvider("azure-ad");
    expect(p!.label).toBe("Azure AD Updated");
    expect(p!.client_id).toBe("new-client");
  });

  test("deleteAuthProvider removes the provider", () => {
    deleteAuthProvider("discord");
    expect(getAuthProvider("discord")).toBeUndefined();
  });
});
