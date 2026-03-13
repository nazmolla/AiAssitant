import { getDb } from "./connection";
import { v4 as uuid } from "uuid";
import { encryptField, decryptField } from "./crypto";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export type LlmProviderType = "azure-openai" | "openai" | "anthropic" | "litellm";
export type LlmProviderPurpose = "chat" | "embedding" | "tts" | "stt";

export interface LlmProviderRecord {
  id: string;
  label: string;
  provider_type: LlmProviderType;
  purpose: LlmProviderPurpose;
  config_json: string;
  is_default: number;
  created_at: string;
}

/** Decrypt sensitive LLM provider fields after reading from DB */
function decryptLlmProvider(p: LlmProviderRecord | undefined): LlmProviderRecord | undefined {
  if (!p) return undefined;
  return {
    ...p,
    config_json: decryptField(p.config_json) ?? "{}",
  };
}

export function listLlmProviders(): LlmProviderRecord[] {
  return appCache.get(
    CACHE_KEYS.LLM_PROVIDERS,
    () => {
      const rows = getDb()
        .prepare("SELECT * FROM llm_providers ORDER BY created_at DESC")
        .all() as LlmProviderRecord[];
      return rows.map((r) => decryptLlmProvider(r)!);
    }
  );
}

export function getLlmProvider(id: string): LlmProviderRecord | undefined {
  const row = getDb()
    .prepare("SELECT * FROM llm_providers WHERE id = ?")
    .get(id) as LlmProviderRecord | undefined;
  return decryptLlmProvider(row);
}

export function getDefaultLlmProvider(purpose: LlmProviderPurpose = "chat"): LlmProviderRecord | undefined {
  const row = getDb()
    .prepare("SELECT * FROM llm_providers WHERE is_default = 1 AND purpose = ? LIMIT 1")
    .get(purpose) as LlmProviderRecord | undefined;
  return decryptLlmProvider(row);
}

export function createLlmProvider(args: {
  label: string;
  providerType: LlmProviderType;
  purpose?: LlmProviderPurpose;
  config: Record<string, unknown>;
  isDefault?: boolean;
}): LlmProviderRecord {
  const id = uuid();
  const purpose = args.purpose || "chat";
  const db = getDb();
  db
    .prepare(
      `INSERT INTO llm_providers (id, label, provider_type, purpose, config_json, is_default)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, args.label, args.providerType, purpose, encryptField(JSON.stringify(args.config)), args.isDefault ? 1 : 0);

  if (args.isDefault || !getDefaultLlmProvider(purpose)) {
    setDefaultLlmProvider(id);
  }

  appCache.invalidate(CACHE_KEYS.LLM_PROVIDERS);
  return getLlmProvider(id)!;
}

export function updateLlmProvider(args: {
  id: string;
  label?: string;
  providerType?: LlmProviderType;
  purpose?: LlmProviderPurpose;
  config?: Record<string, unknown>;
  isDefault?: boolean;
}): LlmProviderRecord | undefined {
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (args.label !== undefined) {
    sets.push("label = ?");
    vals.push(args.label);
  }
  if (args.providerType !== undefined) {
    sets.push("provider_type = ?");
    vals.push(args.providerType);
  }
  if (args.purpose !== undefined) {
    sets.push("purpose = ?");
    vals.push(args.purpose);
  }
  if (args.config !== undefined) {
    sets.push("config_json = ?");
    vals.push(encryptField(JSON.stringify(args.config)));
  }

  if (sets.length > 0) {
    vals.push(args.id);
    getDb()
      .prepare(`UPDATE llm_providers SET ${sets.join(", ")} WHERE id = ?`)
      .run(...vals);
  }

  if (args.isDefault) {
    setDefaultLlmProvider(args.id);
  }

  appCache.invalidate(CACHE_KEYS.LLM_PROVIDERS);
  return getLlmProvider(args.id);
}

export function setDefaultLlmProvider(id: string): void {
  const db = getDb();
  const record = db.prepare("SELECT purpose FROM llm_providers WHERE id = ?").get(id) as { purpose: string } | undefined;
  if (!record) return;
  db.prepare(
    "UPDATE llm_providers SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE purpose = ?"
  ).run(id, record.purpose);
  appCache.invalidate(CACHE_KEYS.LLM_PROVIDERS);
}

export function deleteLlmProvider(id: string): void {
  const db = getDb();
  const record = getLlmProvider(id);
  // PERF-15: Wrap in a single transaction for atomicity
  db.transaction(() => {
    db.prepare("DELETE FROM llm_providers WHERE id = ?").run(id);
    if (record?.is_default) {
      const fallback = db
        .prepare("SELECT id FROM llm_providers WHERE purpose = ? ORDER BY created_at DESC LIMIT 1")
        .get(record.purpose) as { id: string } | undefined;
      if (fallback) {
        setDefaultLlmProvider(fallback.id);
      }
    }
  })();
  appCache.invalidate(CACHE_KEYS.LLM_PROVIDERS);
}
