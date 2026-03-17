/**
 * System prompt constants and helpers for the Nexus agent loop.
 * Extracted from loop.ts for maintainability.
 */

import {
  MAX_TOOL_ITERATIONS,
  UNTRUSTED_TOOL_PREFIXES,
} from "@/lib/constants";
import { NEXUS_SYSTEM_PROMPT } from "@/lib/prompts";

// Re-export so existing imports continue to work
export { MAX_TOOL_ITERATIONS, UNTRUSTED_TOOL_PREFIXES };

export const SYSTEM_PROMPT = NEXUS_SYSTEM_PROMPT;

export function isUntrustedToolOutput(toolName: string): boolean {
  return UNTRUSTED_TOOL_PREFIXES.some((p) => toolName === p || toolName.startsWith("browser_"));
}
