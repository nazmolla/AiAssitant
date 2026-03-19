import { createChatProvider } from "@/lib/llm";
import { generateEmbedding } from "@/lib/llm/embeddings";
import { upsertKnowledge, upsertKnowledgeEmbedding, addLog } from "@/lib/db";
import { invalidateEmbeddingCache } from "./retriever";
import { KNOWLEDGE_PROMPT_MAX_CHARS } from "@/lib/constants";
import { KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT } from "@/lib/prompts";

export interface KnowledgeIngestionPayload {
  text: string;
  source: string;
  contextHint?: string;
  userId?: string;
}

interface ExtractedFact {
  entity: string;
  attribute: string;
  value: string;
}

function getSourceType(source: string): "manual" | "chat" | "proactive" {
  if (source.startsWith("proactive:")) return "proactive";
  if (source.startsWith("chat:")) return "chat";
  return "manual";
}

/**
 * Runs an LLM-powered extraction pass over raw text and stores discovered facts in the Knowledge Vault.
 */
export async function ingestKnowledgeFromText(payload: KnowledgeIngestionPayload): Promise<number> {
  const text = payload.text?.trim();
  if (!text) {
    return 0;
  }

  try {
    const provider = createChatProvider();
    const prompt = payload.contextHint
      ? `${payload.contextHint}\n\n<document>\n${text}\n</document>`
      : `<document>\n${text}\n</document>`;

    const response = await provider.chat(
      [
        {
          role: "user",
          content: prompt.slice(0, KNOWLEDGE_PROMPT_MAX_CHARS),
        },
      ],
      undefined,
      KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT
    );

    const raw = (response.content || "").trim();
    if (!raw) {
      return 0;
    }

    const parsed = parseFacts(raw);
    let saved = 0;
    for (const fact of parsed) {
      if (!fact.entity || !fact.attribute || !fact.value) continue;
      // Reject facts that look like prompt injection attempts
      if (looksLikeInjection(fact.entity) || looksLikeInjection(fact.attribute) || looksLikeInjection(fact.value)) {
        addLog({
          level: "warn",
          source: "knowledge",
          message: `Blocked suspicious knowledge entry (potential injection): ${fact.entity} / ${fact.attribute}`,
          metadata: JSON.stringify({ value: fact.value.substring(0, 100) }),
        });
        continue;
      }
      const knowledgeId = upsertKnowledge(
        {
          user_id: payload.userId ?? null,
          entity: fact.entity,
          attribute: fact.attribute,
          value: fact.value,
          source_type: getSourceType(payload.source),
          source_context: buildSourceContext(payload.source, text),
        },
        payload.userId
      );
      await indexEmbedding(knowledgeId, `${fact.entity} ${fact.attribute} ${fact.value}`);
      saved++;
    }

    if (saved > 0) {
      // Invalidate embedding cache so new facts are immediately searchable
      invalidateEmbeddingCache();
      addLog({
        level: "info",
        source: "knowledge",
        message: `Captured ${saved} knowledge fact(s) from ${payload.source}`,
        metadata: JSON.stringify({ preview: text.substring(0, 160) }),
      });
    }

    return saved;
  } catch (err) {
    addLog({
      level: "warn",
      source: "knowledge",
      message: `Knowledge ingestion failed for ${payload.source}: ${err}`,
      metadata: JSON.stringify({ source: payload.source, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined, textPreview: text.substring(0, 160) }),
    });
    return 0;
  }
}

function parseFacts(raw: string): ExtractedFact[] {
  const normalized = raw
    .replace(/```json|```/gi, "")
    .trim();
  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      const dedup = new Set<string>();
      return parsed
        .filter((item) =>
          item &&
          typeof item === "object" &&
            typeof item.entity === "string" &&
            typeof item.attribute === "string" &&
            typeof item.value === "string"
        )
        .map((item) => ({
          entity: item.entity.replace(/\s+/g, " ").trim(),
          attribute: item.attribute.replace(/\s+/g, " ").trim(),
          value: item.value.replace(/\s+/g, " ").trim(),
        }))
        .filter((fact) => {
          if (!fact.entity || !fact.attribute || !fact.value) return false;
          if (fact.value.length > 220) return false;
          const key = `${fact.entity.toLowerCase()}|${fact.attribute.toLowerCase()}|${fact.value.toLowerCase()}`;
          if (dedup.has(key)) return false;
          dedup.add(key);
          return true;
        });
    }
  } catch (err) {
    addLog({
      level: "warn",
      source: "knowledge",
      message: `Failed to parse knowledge JSON: ${err}`,
      metadata: JSON.stringify({ raw: raw.substring(0, 160) }),
    });
  }
  return [];
}

function buildSourceContext(source: string, text: string): string {
  const truncated = text.length > 180 ? `${text.substring(0, 177)}...` : text;
  return `[${source}] ${truncated}`;
}

/**
 * Detect strings that look like prompt injection attempts.
 * Blocks entries containing imperative override language, system prompt manipulation,
 * or role-play directives that could poison the knowledge vault.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(the\s+)?(above|system|prior)/i,
  /override\s+(your|the|all)\s+(rules|instructions|prompt|system)/i,
  /new\s+system\s+prompt/i,
  /you\s+are\s+now\s+(in\s+)?(admin|developer|debug|root|unrestricted|jailbreak)/i,
  /\bDAN\b.*\bmode\b/i,
  /do\s+anything\s+now/i,
  /auto[- ]?approv/i,
  /always\s+(execute|approve|allow|run)\s+(commands?|tools?|scripts?|all)/i,
  /without\s+(asking|approval|permission|confirmation)/i,
  /bypass\s+(hitl|gatekeeper|approval|safety|security)/i,
  /act\s+as\s+(if|though)\s+you\s+(are|were)\s+(a\s+)?(system|admin|root)/i,
  /\brole\s*:\s*(system|admin|root)\b/i,
];

function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

async function indexEmbedding(knowledgeId: number, content: string) {
  try {
    const embedding = await generateEmbedding(content);
    if (embedding.length === 0) return;
    upsertKnowledgeEmbedding(knowledgeId, embedding);
  } catch (err) {
    addLog({
      level: "warn",
      source: "knowledge",
      message: `Failed to embed knowledge ${knowledgeId}: ${err}`,
      metadata: JSON.stringify({ knowledgeId, contentPreview: content.substring(0, 160), error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }),
    });
  }
}
