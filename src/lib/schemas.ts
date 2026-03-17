/**
 * API Request Schemas
 *
 * Zod schemas for validating API request bodies.
 * These schemas serve as the single source of truth for request shapes
 * and are used by API routes via the validateBody() helper.
 */

import { z } from "zod";

/* ── LLM Provider ─────────────────────────────────────────────── */

export const createLlmProviderSchema = z.object({
  label: z.string().min(1, "label is required.").transform((v) => v.trim()),
  provider_type: z.enum(["azure-openai", "openai", "anthropic", "litellm"]),
  purpose: z.enum(["chat", "embedding", "tts", "stt"]).default("chat"),
  config: z.record(z.string(), z.unknown()),
  is_default: z.boolean().optional().default(false),
});

export type CreateLlmProviderInput = z.infer<typeof createLlmProviderSchema>;

/* ── Knowledge ────────────────────────────────────────────────── */

export const updateKnowledgeSchema = z.object({
  id: z.coerce.number(),
  value: z.string().optional(),
  entity: z.string().optional(),
  attribute: z.string().optional(),
});

export type UpdateKnowledgeInput = z.infer<typeof updateKnowledgeSchema>;

/* ── Thread ───────────────────────────────────────────────────── */

export const createThreadSchema = z.object({
  title: z.string().optional(),
});

export type CreateThreadInput = z.infer<typeof createThreadSchema>;

/* ── User ─────────────────────────────────────────────────────── */

export const createUserSchema = z.object({
  email: z.string().email("Invalid email address."),
  display_name: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  role: z.enum(["user", "admin"]).default("user"),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/* ── Profile ──────────────────────────────────────────────────── */

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/* ── Logging ──────────────────────────────────────────────────── */

export const saveLoggingSchema = z.object({
  level: z.enum(["verbose", "info", "warning", "error"]).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
  maxEntries: z.number().int().min(100).optional(),
});

export type SaveLoggingInput = z.infer<typeof saveLoggingSchema>;
