/**
 * Multi-Agent Framework — Agent Registry
 *
 * Singleton registry for agent type definitions.
 * Ships with a default catalog (agent-catalog.ts) that can be overridden
 * or extended via the `app_config` key `agent_catalog_v1` in the database.
 *
 * Usage:
 *   const registry = AgentRegistry.getInstance();
 *   const def = registry.get("web_researcher");
 *   const allDefs = registry.getAll();
 *   registry.upsert({ id: "custom_agent", ... });
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/171
 */

import { getAppConfig, setAppConfig } from "@/lib/db/log-queries";
import { DEFAULT_AGENT_CATALOG } from "./agent-catalog";
import type { AgentTypeDefinition } from "./types";

const CONFIG_KEY = "agent_catalog_v1";

export class AgentRegistry {
  private static _instance: AgentRegistry | null = null;
  private catalog: AgentTypeDefinition[];

  private constructor() {
    this.catalog = AgentRegistry.loadCatalog();
  }

  /** Get (or create) the singleton registry instance. */
  static getInstance(): AgentRegistry {
    if (!AgentRegistry._instance) {
      AgentRegistry._instance = new AgentRegistry();
    }
    return AgentRegistry._instance;
  }

  /** Reset the singleton — used in tests. */
  static reset(): void {
    AgentRegistry._instance = null;
  }

  /**
   * Load the catalog, merging DB-persisted overrides onto the defaults.
   * Any entry with an id matching a default is overridden; new ids are appended.
   */
  private static loadCatalog(): AgentTypeDefinition[] {
    const base = new Map(DEFAULT_AGENT_CATALOG.map((d) => [d.id, { ...d }]));
    try {
      const raw = getAppConfig(CONFIG_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as AgentTypeDefinition[];
        if (Array.isArray(saved)) {
          for (const entry of saved) {
            if (entry && typeof entry.id === "string") {
              base.set(entry.id, entry);
            }
          }
        }
      }
    } catch {
      // Fall back to defaults silently — DB may not be initialized yet.
    }
    return Array.from(base.values());
  }

  /** Return all registered agent type definitions. */
  getAll(): AgentTypeDefinition[] {
    return this.catalog;
  }

  /** Look up a single definition by id. Returns undefined if not found. */
  get(id: string): AgentTypeDefinition | undefined {
    return this.catalog.find((d) => d.id === id);
  }

  /**
   * Add or update an agent type definition.
   * Persists the change to `app_config` immediately.
   */
  upsert(def: AgentTypeDefinition): void {
    const idx = this.catalog.findIndex((d) => d.id === def.id);
    if (idx >= 0) {
      this.catalog[idx] = def;
    } else {
      this.catalog.push(def);
    }
    try {
      setAppConfig(CONFIG_KEY, JSON.stringify(this.catalog));
    } catch {
      // DB write failure is non-fatal — catalog is still updated in memory.
    }
  }

  /**
   * Remove an agent type by id.
   * Note: removing a default type is persisted so it does not reappear on reload.
   */
  remove(id: string): boolean {
    const idx = this.catalog.findIndex((d) => d.id === id);
    if (idx < 0) return false;
    this.catalog.splice(idx, 1);
    try {
      setAppConfig(CONFIG_KEY, JSON.stringify(this.catalog));
    } catch { /* non-fatal */ }
    return true;
  }

  /** Reload catalog from DB, re-merging with defaults. */
  reload(): void {
    this.catalog = AgentRegistry.loadCatalog();
  }

  /**
   * Build a concise text summary of all registered agents for inclusion in
   * the orchestrator's system prompt.
   */
  buildAgentSummary(): string {
    return this.catalog
      .map((d) => `- **${d.id}**: ${d.name} — ${d.description}`)
      .join("\n");
  }
}
