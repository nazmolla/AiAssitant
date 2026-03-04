/**
 * Model Orchestrator
 *
 * Intelligently routes tasks to the best available LLM model based on:
 *  - Task complexity (reasoning, simple Q&A, summarisation, background)
 *  - Provider capabilities (tool-calling, vision, speed, cost)
 *  - Provider routing tier (primary, secondary, local)
 *  - Availability (fallback if a provider is down)
 *
 * Each LLM provider in the DB can have a `routing_tier` and `capabilities`
 * stored in its config_json. The orchestrator reads all chat providers,
 * classifies the incoming task, and returns the best ChatProvider.
 */

import { listLlmProviders, type LlmProviderRecord } from "@/lib/db";
import type { ChatProvider } from "./types";
import { OpenAIChatProvider } from "./openai-provider";
import { AnthropicChatProvider } from "./anthropic-provider";

// ── Task Classification ───────────────────────────────────────

export type TaskType =
  | "complex"       // Multi-step reasoning, code generation, tool orchestration
  | "simple"        // Quick Q&A, factual lookups, short answers
  | "background"    // Summarisation, knowledge ingestion, title generation
  | "vision";       // Image analysis, screenshot interpretation

export type RoutingTier =
  | "primary"       // Default — highest-capability cloud model
  | "secondary"     // Fallback — cheaper/alternative cloud model
  | "local";        // Local model (Ollama, LiteLLM) — cheapest, good for background

export interface ProviderCapabilities {
  toolCalling: boolean;
  vision: boolean;
  speed: "fast" | "medium" | "slow";
  costTier: "free" | "low" | "medium" | "high";
  maxContextTokens?: number;
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  toolCalling: true,
  vision: false,
  speed: "medium",
  costTier: "medium",
};

// ── Heuristic Task Classifier ─────────────────────────────────

const COMPLEX_SIGNALS = [
  /\b(debug|fix|implement|refactor|architect|design|build|deploy|create.*app|write.*code)\b/i,
  /\b(step[- ]by[- ]step|multi[- ]step|plan|strategy|analyze|compare)\b/i,
  /\b(function|class|api|endpoint|database|schema|migration)\b/i,
  /```/,              // Code fences suggest code tasks
  /\b(why|how\s+does|explain\s+in\s+detail)\b/i,
];

const SIMPLE_SIGNALS = [
  /^(what|who|when|where)\s+(is|are|was|were)\b/i,
  /\b(define|meaning of|translate|convert|calculate)\b/i,
  /^.{1,60}$/,        // Very short messages are usually simple
];

const BACKGROUND_SIGNALS = [
  /\b(summarize|summary|summarise|title|headline|tldr|digest|recap)\b/i,
  /\b(ingest|extract\s+knowledge|background\s+task)\b/i,
];

const VISION_SIGNALS = [
  /\b(screenshot|image|picture|photo|visual|look\s+at)\b/i,
  /\b(what\s+do\s+you\s+see|describe\s+this\s+image)\b/i,
];

/**
 * Classify a user message into a task type using lightweight heuristics.
 * No LLM call — runs in microseconds.
 */
export function classifyTask(message: string, hasImages?: boolean): TaskType {
  if (hasImages) return "vision";
  if (VISION_SIGNALS.some((r) => r.test(message))) return "vision";
  if (BACKGROUND_SIGNALS.some((r) => r.test(message))) return "background";
  // Check complex before simple — complex signals take priority
  if (COMPLEX_SIGNALS.some((r) => r.test(message))) return "complex";
  if (SIMPLE_SIGNALS.some((r) => r.test(message))) return "simple";
  // Default: complex (safer to over-estimate than under-estimate)
  return "complex";
}

// ── Provider Scoring ──────────────────────────────────────────

interface ScoredProvider {
  record: LlmProviderRecord;
  config: Record<string, unknown>;
  capabilities: ProviderCapabilities;
  tier: RoutingTier;
  score: number;
}

function parseProviderConfig(record: LlmProviderRecord): {
  config: Record<string, unknown>;
  capabilities: ProviderCapabilities;
  tier: RoutingTier;
} {
  let config: Record<string, unknown> = {};
  try {
    config = record.config_json ? JSON.parse(record.config_json) : {};
  } catch {
    // ignore
  }

  const tier = (config.routingTier as RoutingTier) || inferTier(record);
  const capabilities = {
    ...DEFAULT_CAPABILITIES,
    ...(config.capabilities as Partial<ProviderCapabilities> | undefined),
    ...inferCapabilities(record, config),
  };

  return { config, capabilities, tier };
}

function inferTier(record: LlmProviderRecord): RoutingTier {
  if (record.provider_type === "litellm") return "local";
  return "primary";
}

function inferCapabilities(
  record: LlmProviderRecord,
  config: Record<string, unknown>
): Partial<ProviderCapabilities> {
  const model = ((config.model || config.deployment || "") as string).toLowerCase();
  const inferred: Partial<ProviderCapabilities> = {};

  // Vision capability detection
  if (model.includes("gpt-4o") || model.includes("gpt-4-vision") || model.includes("claude-3") || model.includes("claude-sonnet") || model.includes("claude-opus")) {
    inferred.vision = true;
  }

  // Speed / cost heuristics
  if (model.includes("mini") || model.includes("haiku") || model.includes("flash")) {
    inferred.speed = "fast";
    inferred.costTier = "low";
  } else if (model.includes("opus") || model.includes("o1") || model.includes("o3")) {
    inferred.speed = "slow";
    inferred.costTier = "high";
  }

  // Local models
  if (record.provider_type === "litellm") {
    inferred.costTier = "free";
    inferred.speed = "medium";
  }

  return inferred;
}

/**
 * Score a provider for a given task type. Higher = better match.
 */
function scoreProvider(
  capabilities: ProviderCapabilities,
  tier: RoutingTier,
  taskType: TaskType
): number {
  let score = 0;

  switch (taskType) {
    case "complex":
      // Prefer primary cloud models with tool-calling
      if (tier === "primary") score += 100;
      else if (tier === "secondary") score += 60;
      else score += 20; // local
      if (capabilities.toolCalling) score += 50;
      if (capabilities.speed === "slow") score += 10; // slower = smarter
      break;

    case "simple":
      // Prefer fast, cheap models
      if (capabilities.speed === "fast") score += 50;
      if (capabilities.costTier === "free") score += 40;
      else if (capabilities.costTier === "low") score += 30;
      if (tier === "local") score += 30;
      else if (tier === "secondary") score += 20;
      else score += 10;
      if (capabilities.toolCalling) score += 10;
      break;

    case "background":
      // Strongly prefer local/cheap models
      if (tier === "local") score += 100;
      else if (tier === "secondary") score += 40;
      else score += 10;
      if (capabilities.costTier === "free") score += 80;
      else if (capabilities.costTier === "low") score += 50;
      if (capabilities.speed === "fast") score += 20;
      break;

    case "vision":
      // Must have vision capability
      if (capabilities.vision) score += 200;
      else score -= 1000; // effectively disqualify
      if (tier === "primary") score += 30;
      if (capabilities.toolCalling) score += 10;
      break;
  }

  return score;
}

// ── Provider Builder ──────────────────────────────────────────

function buildProvider(record: LlmProviderRecord, config: Record<string, unknown>): ChatProvider {
  switch (record.provider_type) {
    case "azure-openai": {
      const apiKey = config.apiKey as string;
      const endpoint = config.endpoint as string;
      const deployment = config.deployment as string;
      const apiVersion = config.apiVersion as string | undefined;
      const disableThinking = config.disableThinking === true;
      return new OpenAIChatProvider({ variant: "azure", apiKey, endpoint, deployment, apiVersion, disableThinking });
    }
    case "openai": {
      const apiKey = config.apiKey as string;
      const model = config.model as string | undefined;
      const baseURL = config.baseURL as string | undefined;
      const disableThinking = config.disableThinking === true;
      return new OpenAIChatProvider({ variant: "openai", apiKey, model, baseURL, disableThinking });
    }
    case "anthropic": {
      const apiKey = config.apiKey as string;
      const model = config.model as string | undefined;
      return new AnthropicChatProvider({ apiKey, model });
    }
    case "litellm": {
      const apiKey = (config.apiKey as string) || "no-key-required";
      const model = config.model as string | undefined;
      const baseURL = config.baseURL as string | undefined;
      const disableThinking = config.disableThinking === true;
      return new OpenAIChatProvider({ variant: "openai", apiKey, model, baseURL, disableThinking });
    }
    default:
      throw new Error(`Unknown provider type: ${record.provider_type}`);
  }
}

// ── Public API ────────────────────────────────────────────────

export interface OrchestratorResult {
  provider: ChatProvider;
  providerLabel: string;
  taskType: TaskType;
  tier: RoutingTier;
  reason: string;
}

/**
 * Select the best LLM provider for a given task.
 *
 * @param message  The user's message (used for classification)
 * @param hasImages Whether the message includes images
 * @param preferredTier Optional tier override (e.g., force "local" for background)
 */
export function selectProvider(
  message: string,
  hasImages?: boolean,
  preferredTier?: RoutingTier
): OrchestratorResult {
  const taskType = classifyTask(message, hasImages);
  const allProviders = listLlmProviders().filter((p) => p.purpose === "chat");

  if (allProviders.length === 0) {
    throw new Error("[Nexus] No LLM provider configured. Add one in Settings → LLM Providers.");
  }

  // Score all providers
  const scored: ScoredProvider[] = allProviders.map((record) => {
    const { config, capabilities, tier } = parseProviderConfig(record);
    let score = scoreProvider(capabilities, tier, taskType);

    // Boost preferred tier
    if (preferredTier && tier === preferredTier) {
      score += 150;
    }

    // Boost default provider slightly (user preference)
    if (record.is_default) {
      score += 15;
    }

    return { record, config, capabilities, tier, score };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  const provider = buildProvider(best.record, best.config);
  const reason = buildReason(best, taskType, scored.length);

  return {
    provider,
    providerLabel: best.record.label,
    taskType,
    tier: best.tier,
    reason,
  };
}

/**
 * Select the best provider AND return its raw config for worker thread usage.
 * The raw config contains the decrypted apiKey, model, endpoint, etc. that
 * the worker needs to create its own SDK client instance.
 */
export interface WorkerProviderInfo extends OrchestratorResult {
  providerType: string;
  providerConfig: Record<string, unknown>;
}

export function selectProviderForWorker(
  message: string,
  hasImages?: boolean,
  preferredTier?: RoutingTier
): WorkerProviderInfo {
  const taskType = classifyTask(message, hasImages);
  const allProviders = listLlmProviders().filter((p) => p.purpose === "chat");

  if (allProviders.length === 0) {
    throw new Error("[Nexus] No LLM provider configured. Add one in Settings → LLM Providers.");
  }

  const scored: ScoredProvider[] = allProviders.map((record) => {
    const { config, capabilities, tier } = parseProviderConfig(record);
    let score = scoreProvider(capabilities, tier, taskType);
    if (preferredTier && tier === preferredTier) score += 150;
    if (record.is_default) score += 15;
    return { record, config, capabilities, tier, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  const provider = buildProvider(best.record, best.config);
  const reason = buildReason(best, taskType, scored.length);

  return {
    provider,
    providerLabel: best.record.label,
    taskType,
    tier: best.tier,
    reason,
    providerType: best.record.provider_type,
    providerConfig: best.config,
  };
}

/**
 * Get a provider specifically for background/non-interactive tasks.
 * Prefers local models to save costs. Falls back to primary if no local available.
 */
export function selectBackgroundProvider(): OrchestratorResult {
  return selectProvider("summarize this", false, "local");
}

function buildReason(best: ScoredProvider, taskType: TaskType, totalProviders: number): string {
  const parts = [
    `Task: ${taskType}`,
    `Provider: ${best.record.label} (${best.tier})`,
    `Score: ${best.score}/${totalProviders} evaluated`,
  ];
  return parts.join(" · ");
}
