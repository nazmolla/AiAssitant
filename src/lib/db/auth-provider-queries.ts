import { getDb } from "./connection";
import { encryptField, decryptField } from "./crypto";
import { appCache, CACHE_KEYS } from "@/lib/cache";

// ——— Authentication Providers ———————————————————————————————

export type AuthProviderType = "azure-ad" | "google" | "discord";

export interface AuthProviderRecord {
  id: string;
  provider_type: AuthProviderType;
  label: string;
  client_id: string | null;
  client_secret: string | null;
  tenant_id: string | null;
  bot_token: string | null;
  application_id: string | null;
  enabled: number;
  created_at: string;
}

/** Decrypt sensitive auth provider fields after reading from DB */
function decryptAuthProvider(p: AuthProviderRecord | undefined): AuthProviderRecord | undefined {
  if (!p) return undefined;
  return {
    ...p,
    client_secret: decryptField(p.client_secret) as string | null,
    bot_token: decryptField(p.bot_token) as string | null,
  };
}

export function listAuthProviders(): AuthProviderRecord[] {
  return appCache.get(CACHE_KEYS.AUTH_PROVIDERS, () => {
    const rows = getDb()
      .prepare("SELECT * FROM auth_providers ORDER BY created_at ASC")
      .all() as AuthProviderRecord[];
    return rows.map((r) => decryptAuthProvider(r)!);
  });
}

export function getEnabledAuthProviders(): AuthProviderRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM auth_providers WHERE enabled = 1 ORDER BY created_at ASC")
    .all() as AuthProviderRecord[];
  return rows.map((r) => decryptAuthProvider(r)!);
}

export function getAuthProvider(id: string): AuthProviderRecord | undefined {
  const row = getDb()
    .prepare("SELECT * FROM auth_providers WHERE id = ?")
    .get(id) as AuthProviderRecord | undefined;
  return decryptAuthProvider(row);
}

export function getAuthProviderByType(providerType: AuthProviderType): AuthProviderRecord | undefined {
  const row = getDb()
    .prepare("SELECT * FROM auth_providers WHERE provider_type = ? LIMIT 1")
    .get(providerType) as AuthProviderRecord | undefined;
  return decryptAuthProvider(row);
}

export function upsertAuthProvider(args: {
  providerType: AuthProviderType;
  label: string;
  clientId?: string | null;
  clientSecret?: string | null;
  tenantId?: string | null;
  botToken?: string | null;
  applicationId?: string | null;
  enabled?: boolean;
}): AuthProviderRecord {
  const id = args.providerType; // use type as id — only one per type
  const db = getDb();
  db.prepare(
    `INSERT INTO auth_providers (id, provider_type, label, client_id, client_secret, tenant_id, bot_token, application_id, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       client_id = excluded.client_id,
       client_secret = excluded.client_secret,
       tenant_id = excluded.tenant_id,
       bot_token = excluded.bot_token,
       application_id = excluded.application_id,
       enabled = excluded.enabled`
  ).run(
    id,
    args.providerType,
    args.label,
    args.clientId ?? null,
    encryptField(args.clientSecret ?? null),
    args.tenantId ?? null,
    encryptField(args.botToken ?? null),
    args.applicationId ?? null,
    args.enabled !== false ? 1 : 0
  );
  appCache.invalidate(CACHE_KEYS.AUTH_PROVIDERS);
  return getAuthProvider(id)!;
}

export function deleteAuthProvider(id: string): void {
  getDb().prepare("DELETE FROM auth_providers WHERE id = ?").run(id);
  appCache.invalidate(CACHE_KEYS.AUTH_PROVIDERS);
}
