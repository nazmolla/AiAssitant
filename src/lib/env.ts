/**
 * Centralized Environment Configuration
 *
 * Single source of truth for all process.env reads.
 * Provides typed, validated access to environment variables with
 * startup-time validation via Zod schemas.
 *
 * Usage:
 *   import { env } from "@/lib/env";
 *   const dbPath = env.DATABASE_PATH;
 *
 * Note: NEXT_PUBLIC_* vars are NOT included here — Next.js inlines
 * them at build time and they must be accessed via process.env directly.
 */

import path from "path";
import { z } from "zod";

export const envSchema = z.object({
  DATABASE_PATH: z.string().min(1).default(path.join(process.cwd(), "nexus.db")),
  NEXUS_DB_SECRET: z.string().optional(),
  NEXTAUTH_SECRET: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DISABLE_REGISTRATION: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  PROACTIVE_CRON_SCHEDULE: z.string().min(1).default("*/15 * * * *"),
  FS_ALLOWED_ROOT: z
    .string()
    .default(process.cwd())
    .transform((v) => path.resolve(v)),
  WORKER_POOL_SIZE: z
    .string()
    .default("2")
    .transform((v) => Math.max(parseInt(v, 10) || 2, 1)),
  NEXUS_DEDUPE_KNOWLEDGE_STARTUP: z
    .string()
    .default("0")
    .transform((v) => v === "1"),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${formatted}`);
  }
  return Object.freeze(result.data);
}

/** Frozen, typed environment configuration. */
export const env: EnvConfig = loadEnv();
