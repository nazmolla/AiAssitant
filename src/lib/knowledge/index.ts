import { createChatProvider } from "@/lib/llm";
import { generateEmbedding } from "@/lib/llm/embeddings";
import { upsertKnowledge, upsertKnowledgeEmbedding, addLog } from "@/lib/db";

export interface KnowledgeIngestionPayload {
  text: string;
  source: string;
  contextHint?: string;
}

const EXTRACTION_SYSTEM_PROMPT = `You are the Nexus Knowledge Curator.
Extract durable facts about the owner from the provided text. Only capture preferences, constraints, recurring commitments, identities, or other long-lived details that would still matter in future conversations.

Return a JSON array. Each element must have: "entity", "attribute", "value". Use concise natural language strings.
If no durable facts are present, respond with [] and nothing else.`;

interface ExtractedFact {
  entity: string;
  attribute: string;
  value: string;
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
      ? `${payload.contextHint}\n\n${text}`
      : text;

    const response = await provider.chat(
      [
        {
          role: "user",
          content: prompt.slice(0, 8000),
        },
      ],
      undefined,
      EXTRACTION_SYSTEM_PROMPT
    );

    const raw = (response.content || "").trim();
    if (!raw) {
      return 0;
    }

    const parsed = parseFacts(raw);
    let saved = 0;
    for (const fact of parsed) {
      if (!fact.entity || !fact.attribute || !fact.value) continue;
      const knowledgeId = upsertKnowledge({
        entity: fact.entity,
        attribute: fact.attribute,
        value: fact.value,
        source_context: buildSourceContext(payload.source, text),
      });
      await indexEmbedding(knowledgeId, `${fact.entity} ${fact.attribute} ${fact.value}`);
      saved++;
    }

    if (saved > 0) {
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
      metadata: null,
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
      return parsed
        .filter((item) =>
          item &&
          typeof item === "object" &&
            typeof item.entity === "string" &&
            typeof item.attribute === "string" &&
            typeof item.value === "string"
        )
        .map((item) => ({
          entity: item.entity.trim(),
          attribute: item.attribute.trim(),
          value: item.value.trim(),
        }));
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
  const truncated = text.length > 400 ? `${text.substring(0, 397)}...` : text;
  return `[${source}] ${truncated}`;
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
      metadata: null,
    });
  }
}
