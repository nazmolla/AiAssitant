/**
 * Built-in Knowledge Vault Tools for Nexus Agent
 *
 * Exposes the user's knowledge vault as active, queryable tools so the
 * agent can explicitly retrieve facts mid-conversation rather than relying
 * solely on passive context injection.
 *
 *  - builtin.knowledge_search  — semantic + keyword search by query string
 *  - builtin.knowledge_list    — list all entries (optional entity filter)
 */

import type { ToolDefinition } from "@/lib/llm";
import { retrieveKnowledge } from "@/lib/knowledge/retriever";
import { listKnowledge, searchKnowledge } from "@/lib/db";
import { BaseTool, type ToolExecutionContext, registerToolCategory } from "./base-tool";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("tools.knowledge-tools");

// ── Tool Definitions ──────────────────────────────────────────

export const BUILTIN_KNOWLEDGE_TOOLS: ToolDefinition[] = [
  {
    name: "builtin.knowledge_search",
    description:
      "Search the user's personal knowledge vault for facts, preferences, career history, and stored information. " +
      "Use this before generating any personalised content (announcements, bios, resumes, emails) to retrieve relevant details about the user. " +
      "Returns matching entries as entity/attribute/value triples.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to look for — e.g. 'career history', 'company', 'skills', 'contact info'.",
        },
        limit: {
          type: "number",
          description: "Maximum number of entries to return (default 12, max 30).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "builtin.knowledge_list",
    description:
      "List all entries in the user's knowledge vault, optionally filtered by entity name. " +
      "Use this to get a full picture of what is stored — useful before generating documents that need comprehensive personal context.",
    inputSchema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description: "Optional entity name to filter by (e.g. the user's name or 'user'). Omit to list all.",
        },
        limit: {
          type: "number",
          description: "Maximum entries to return (default 50, max 200).",
        },
      },
      required: [],
    },
  },
];

export const KNOWLEDGE_TOOL_NAMES = BUILTIN_KNOWLEDGE_TOOLS.map((t) => t.name);

export function isKnowledgeTool(name: string): boolean {
  return KNOWLEDGE_TOOL_NAMES.includes(name);
}

// ── Execution ─────────────────────────────────────────────────

export async function executeBuiltinKnowledgeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<unknown> {
  const { userId } = context;
  log.enter("executeBuiltinKnowledgeTool", { name, userId });

  if (!userId) {
    return { error: "No authenticated user — knowledge vault unavailable." };
  }

  switch (name) {
    case "builtin.knowledge_search": {
      const query = args.query as string;
      const limit = Math.min((args.limit as number) || 12, 30);

      // Semantic search with keyword fallback (same pipeline as context injection)
      const semantic = await retrieveKnowledge(query, limit, userId);

      // Fill remaining slots with keyword fallback if semantic returned fewer
      const remaining = limit - semantic.length;
      let merged = semantic;
      if (remaining > 0) {
        const seenIds = new Set(semantic.map((e) => e.id));
        const keyword = searchKnowledge(query, userId)
          .filter((e) => !seenIds.has(e.id))
          .slice(0, remaining);
        merged = [...semantic, ...keyword];
      }

      log.exit("executeBuiltinKnowledgeTool", { name, count: merged.length });
      return {
        query,
        count: merged.length,
        entries: merged.map((e) => ({
          entity: e.entity,
          attribute: e.attribute,
          value: e.value,
          last_updated: e.last_updated,
        })),
      };
    }

    case "builtin.knowledge_list": {
      const entityFilter = (args.entity as string | undefined)?.toLowerCase().trim();
      const limit = Math.min((args.limit as number) || 50, 200);

      let entries = listKnowledge(userId, limit);
      if (entityFilter) {
        entries = entries.filter((e) => e.entity.toLowerCase().includes(entityFilter));
      }

      log.exit("executeBuiltinKnowledgeTool", { name, count: entries.length });
      return {
        total: entries.length,
        entityFilter: entityFilter || null,
        entries: entries.map((e) => ({
          entity: e.entity,
          attribute: e.attribute,
          value: e.value,
          last_updated: e.last_updated,
        })),
      };
    }

    default:
      throw new Error(`Unknown knowledge tool: ${name}`);
  }
}

// ── BaseTool class wrapper ────────────────────────────────────

export class KnowledgeTools extends BaseTool {
  readonly name = "knowledge";
  readonly toolNamePrefix = "builtin.knowledge_";
  readonly registrationOrder = 5;
  readonly tools = BUILTIN_KNOWLEDGE_TOOLS;
  readonly toolsRequiringApproval: string[] = [];

  matches(toolName: string): boolean {
    return isKnowledgeTool(toolName);
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    return executeBuiltinKnowledgeTool(toolName, args, context);
  }
}

export const knowledgeTools = new KnowledgeTools();
registerToolCategory(knowledgeTools);
