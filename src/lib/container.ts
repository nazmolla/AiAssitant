/**
 * Dependency Injection Interfaces & Container
 *
 * Lightweight service locator for cross-cutting concerns.
 * Each interface abstracts a concrete singleton so that:
 *  - Tests can inject mock implementations without jest.mock() path hacking
 *  - Swapping implementations (e.g., Redis cache, PostgreSQL) touches one file
 *
 * Usage:
 *   import { container } from "@/lib/container";
 *   const cache = container.resolve("cache");   // ICache
 *   const logger = container.resolve("logger");  // ILogger
 *
 * Tests:
 *   container.register("cache", mockCache);
 *   // ... run code under test ...
 *   container.reset(); // restore defaults
 */

import type { UnifiedLogLevel } from "@/lib/logging/levels";

// ── Interfaces ────────────────────────────────────────────────

/** Cache abstraction — sync and async reads with TTL, invalidation. */
export interface ICache {
  get<T>(key: string, loader: () => T, ttlMs?: number): T;
  getAsync<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T>;
  set<T>(key: string, data: T): void;
  invalidate(key: string): void;
  invalidatePrefix(prefix: string): void;
  invalidateAll(): void;
  readonly size: number;
}

/** Structured logger abstraction. */
export interface ILogger {
  log(level: UnifiedLogLevel, source: string | null, message: string, metadata?: string | null): void;
  verbose(source: string | null, message: string, metadata?: string | null): void;
  warning(source: string | null, message: string, metadata?: string | null): void;
  error(source: string | null, message: string, metadata?: string | null): void;
}

// ── Service Registry ──────────────────────────────────────────

interface ServiceMap {
  cache: ICache;
  logger: ILogger;
}

type ServiceName = keyof ServiceMap;

type Factory<T> = () => T;

class Container {
  private factories = new Map<string, Factory<unknown>>();
  private singletons = new Map<string, unknown>();
  private defaults = new Map<string, Factory<unknown>>();

  /**
   * Register a factory for a service. Clears any existing singleton
   * so the next `resolve()` call uses the new factory.
   */
  register<K extends ServiceName>(name: K, instanceOrFactory: ServiceMap[K] | Factory<ServiceMap[K]>): void {
    const factory = typeof instanceOrFactory === "function" && !("get" in instanceOrFactory || "log" in instanceOrFactory)
      ? instanceOrFactory as Factory<ServiceMap[K]>
      : () => instanceOrFactory as ServiceMap[K];
    this.factories.set(name, factory as Factory<unknown>);
    this.singletons.delete(name);
  }

  /**
   * Register a default factory (called once at module load time).
   * Only used as fallback when no explicit registration exists.
   */
  registerDefault<K extends ServiceName>(name: K, factory: Factory<ServiceMap[K]>): void {
    this.defaults.set(name, factory as Factory<unknown>);
  }

  /**
   * Resolve a service. Lazily creates a singleton from the registered
   * (or default) factory on first call.
   */
  resolve<K extends ServiceName>(name: K): ServiceMap[K] {
    let instance = this.singletons.get(name);
    if (instance) return instance as ServiceMap[K];

    const factory = this.factories.get(name) ?? this.defaults.get(name);
    if (!factory) {
      throw new Error(`No factory registered for service "${name}"`);
    }
    instance = factory();
    this.singletons.set(name, instance);
    return instance as ServiceMap[K];
  }

  /** Reset all registrations to defaults (for test teardown). */
  reset(): void {
    this.factories.clear();
    this.singletons.clear();
  }
}

/** Global service container. */
export const container = new Container();
