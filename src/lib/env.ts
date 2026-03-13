/**
 * Centralized Environment Configuration
 *
 * Single source of truth for all process.env reads.
 * Provides typed, validated access to environment variables with
 * startup-time validation for required values.
 *
 * Usage:
 *   import { env } from "@/lib/env";
 *   const dbPath = env.DATABASE_PATH;
 *
 * Note: NEXT_PUBLIC_* vars are NOT included here — Next.js inlines
 * them at build time and they must be accessed via process.env directly.
 */

import path from "path";

interface EnvConfig {
  /** Path to the SQLite database file. */
  readonly DATABASE_PATH: string;
  /** Secret for encrypting/decrypting sensitive DB fields. */
  readonly NEXUS_DB_SECRET: string | undefined;
  /** NextAuth session signing secret. */
  readonly NEXTAUTH_SECRET: string | undefined;
  /** Current Node environment. */
  readonly NODE_ENV: "development" | "production" | "test";
  /** Whether new user registration is disabled. */
  readonly DISABLE_REGISTRATION: boolean;
  /** Cron schedule for proactive knowledge scans. */
  readonly PROACTIVE_CRON_SCHEDULE: string;
  /** Root directory for file-system tool access. */
  readonly FS_ALLOWED_ROOT: string;
  /** Number of worker threads for background tasks. */
  readonly WORKER_POOL_SIZE: number;
  /** Whether to deduplicate knowledge entries on startup. */
  readonly NEXUS_DEDUPE_KNOWLEDGE_STARTUP: boolean;
}

function loadEnv(): EnvConfig {
  const nodeEnv = (process.env.NODE_ENV || "development") as EnvConfig["NODE_ENV"];

  return Object.freeze({
    DATABASE_PATH:
      process.env.DATABASE_PATH || path.join(process.cwd(), "nexus.db"),

    NEXUS_DB_SECRET: process.env.NEXUS_DB_SECRET,

    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,

    NODE_ENV: nodeEnv,

    DISABLE_REGISTRATION: process.env.DISABLE_REGISTRATION === "true",

    PROACTIVE_CRON_SCHEDULE:
      process.env.PROACTIVE_CRON_SCHEDULE || "*/15 * * * *",

    FS_ALLOWED_ROOT: path.resolve(
      process.env.FS_ALLOWED_ROOT || process.cwd()
    ),

    WORKER_POOL_SIZE: Math.max(
      parseInt(process.env.WORKER_POOL_SIZE || "2", 10) || 2,
      1,
    ),

    NEXUS_DEDUPE_KNOWLEDGE_STARTUP:
      process.env.NEXUS_DEDUPE_KNOWLEDGE_STARTUP === "1",
  });
}

/** Frozen, typed environment configuration. */
export const env: EnvConfig = loadEnv();
