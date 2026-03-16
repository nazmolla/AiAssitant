import type { ToolDefinition } from "@/lib/llm";

export interface DuplicateToolCandidate {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface DuplicateToolMatch {
  toolName: string;
  reason: string;
  score: number;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it", "of", "on", "or", "that", "the", "to", "with", "your", "you", "this", "these", "those", "using", "use",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .map((token) => token.replace(/(ing|ed|es|s)$/g, ""))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function overlapCount(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  return intersection;
}

function getSchemaPropertyKeys(inputSchema?: Record<string, unknown>): string[] {
  const properties = inputSchema?.properties;
  if (!properties || typeof properties !== "object") return [];
  return Object.keys(properties as Record<string, unknown>).map((key) => key.toLowerCase());
}

function schemaOverlap(candidate: string[], existing: string[]): number {
  if (candidate.length === 0 || existing.length === 0) return 0;
  return jaccardSimilarity(candidate, existing);
}

function toCandidate(tool: ToolDefinition): DuplicateToolCandidate {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: (tool.inputSchema && typeof tool.inputSchema === "object") ? (tool.inputSchema as Record<string, unknown>) : undefined,
  };
}

export function findDuplicateToolMatch(
  candidate: DuplicateToolCandidate,
  existingTools: ToolDefinition[]
): DuplicateToolMatch | null {
  const candidateTokens = tokenize(candidate.description);
  const candidateSchemaKeys = getSchemaPropertyKeys(candidate.inputSchema);
  const normalizedCandidateDescription = candidate.description.trim().toLowerCase();

  let best: DuplicateToolMatch | null = null;

  for (const existing of existingTools) {
    if (existing.name === candidate.name) continue;

    const existingCandidate = toCandidate(existing);
    const normalizedExistingDescription = existingCandidate.description.trim().toLowerCase();

    if (normalizedCandidateDescription && normalizedCandidateDescription === normalizedExistingDescription) {
      return {
        toolName: existingCandidate.name,
        reason: "description-exact-match",
        score: 1,
      };
    }

    const existingTokens = tokenize(existingCandidate.description);
    const descriptionSimilarity = jaccardSimilarity(candidateTokens, existingTokens);
    const tokenIntersection = overlapCount(candidateTokens, existingTokens);
    const candidateHasEnoughTokens = candidateTokens.length >= 5;
    const existingHasEnoughTokens = existingTokens.length >= 5;

    const existingSchemaKeys = getSchemaPropertyKeys(existingCandidate.inputSchema);
    const schemaSimilarity = schemaOverlap(candidateSchemaKeys, existingSchemaKeys);

    const isSemanticDuplicate =
      candidateHasEnoughTokens &&
      existingHasEnoughTokens &&
      (descriptionSimilarity >= 0.5 || tokenIntersection >= 4) &&
      schemaSimilarity >= 0.3;

    if (!isSemanticDuplicate) continue;

    const score = Math.min(1, descriptionSimilarity * 0.8 + schemaSimilarity * 0.2);
    if (!best || score > best.score) {
      best = {
        toolName: existingCandidate.name,
        reason: "description-schema-overlap",
        score,
      };
    }
  }

  return best;
}
