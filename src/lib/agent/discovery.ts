import type { ToolDefinition, ToolCall } from "@/lib/llm";
import { getMcpManager } from "@/lib/mcp";
import { ALL_TOOL_CATEGORIES } from "@/lib/tools";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("agent.discovery");

export interface DiscoveredTool extends ToolDefinition {
  source: "builtin" | "custom" | "mcp";
  group: string;
}

const TOOL_PREFIX_GROUPS: Array<{ prefix: string; group: string }> = [
  { prefix: "builtin.web_", group: "Web Tools" },
  { prefix: "builtin.browser_", group: "Browser Tools" },
  { prefix: "builtin.fs_", group: "File System" },
  { prefix: "builtin.net_", group: "Network Tools" },
  { prefix: "builtin.channel_", group: "Communication Channels" },
  { prefix: "builtin.file_", group: "File Generation" },
  { prefix: "builtin.nexus_", group: "Tool Management" },
  { prefix: "builtin.alexa_", group: "Alexa Smart Home" },
  { prefix: "custom.", group: "Custom Tools" },
];

function getRegisteredTools(): ToolDefinition[] {
  const deduped = new Map<string, ToolDefinition>();
  for (const category of ALL_TOOL_CATEGORIES) {
    for (const tool of category.tools) {
      deduped.set(tool.name, tool);
    }
  }
  return Array.from(deduped.values());
}

function collectApprovalRequiredToolNames(): Set<string> {
  const names = new Set<string>();
  for (const category of ALL_TOOL_CATEGORIES) {
    for (const toolName of category.toolsRequiringApproval) {
      names.add(toolName);
    }
  }
  return names;
}

const TOOLS_REQUIRING_APPROVAL = collectApprovalRequiredToolNames();

function inferGroup(toolName: string): string {
  for (const entry of TOOL_PREFIX_GROUPS) {
    if (toolName.startsWith(entry.prefix)) return entry.group;
  }
  return "Other";
}

export function getAllBuiltinTools(): ToolDefinition[] {
  return getRegisteredTools().filter((tool) => !tool.name.startsWith("custom."));
}

export function discoverAllTools(): DiscoveredTool[] {
  const t0 = Date.now();
  log.enter("discoverAllTools");
  const registered = getRegisteredTools().map((tool) => ({
    ...tool,
    source: tool.name.startsWith("custom.") ? ("custom" as const) : ("builtin" as const),
    group: inferGroup(tool.name),
  }));

  const mcp = getMcpManager().getAllTools().map((tool) => ({
    ...tool,
    source: "mcp" as const,
    group: "MCP Tools",
  }));

  const deduped = new Map<string, DiscoveredTool>();
  for (const tool of [...registered, ...mcp]) {
    deduped.set(tool.name, tool);
  }
  const tools = Array.from(deduped.values());
  log.exit("discoverAllTools", { count: tools.length }, Date.now() - t0);
  return tools;
}

export function defaultRequiresApproval(toolName: string, source: DiscoveredTool["source"]): number {
  if (TOOLS_REQUIRING_APPROVAL.has(toolName)) return 1;
  if (source === "mcp") return 1;
  return 0;
}

/* -------------------------------------------------------------------------- */
/*  Tool name normalization                                                     */
/* -------------------------------------------------------------------------- */

/** Lazy-loaded set of all known builtin tool names (without the "builtin." prefix). */
let _builtinShortNames: Map<string, string> | null = null;

function getBuiltinShortNameMap(): Map<string, string> {
  if (!_builtinShortNames) {
    _builtinShortNames = new Map();
    for (const tool of getAllBuiltinTools()) {
      if (tool.name.startsWith("builtin.")) {
        _builtinShortNames.set(tool.name.slice("builtin.".length), tool.name);
      }
    }
  }
  return _builtinShortNames;
}

/**
 * Normalize a tool name the LLM may have mangled.
 *
 * The LLM sometimes strips the "builtin." prefix when calling a tool
 * (e.g. "alexa_announce" instead of "builtin.alexa_announce").
 * This function restores it when the short name matches a known builtin.
 */
export function normalizeToolName(name: string): string {
  // Already qualified (contains a dot) — return as-is
  if (name.includes(".")) return name;

  const fullName = getBuiltinShortNameMap().get(name);
  return fullName ?? name;
}

/* -------------------------------------------------------------------------- */
/*  multi_tool_use.parallel expansion                                          */
/* -------------------------------------------------------------------------- */

/**
 * Expand OpenAI's `multi_tool_use.parallel` synthetic tool call into
 * individual tool calls. Some models emit this instead of returning
 * multiple separate tool_calls entries.
 *
 * Expected arguments format:
 *   { tool_uses: [{ recipient_name: "functions.toolName", parameters: {...} }] }
 */
export function expandMultiToolUse(toolCalls: ToolCall[]): ToolCall[] {
  log.enter("expandMultiToolUse", { count: toolCalls.length });
  const expanded: ToolCall[] = [];
  for (const tc of toolCalls) {
    if (tc.name === "multi_tool_use.parallel" || tc.name === "multi_tool_use") {
      const toolUses = tc.arguments?.tool_uses;
      if (Array.isArray(toolUses)) {
        for (let i = 0; i < toolUses.length; i++) {
          const use = toolUses[i] as { recipient_name?: string; parameters?: Record<string, unknown> } | undefined;
          const recipientName = typeof use?.recipient_name === "string"
            ? use.recipient_name.replace(/^functions\./, "")
            : "";
          if (recipientName) {
            expanded.push({
              id: `${tc.id}_${i}`,
              name: recipientName,
              arguments: use?.parameters ?? {},
            });
          }
        }
      }
      // Skip the original multi_tool_use call — it's been expanded
    } else {
      expanded.push(tc);
    }
  }
  log.exit("expandMultiToolUse", { expanded: expanded.length });
  return expanded;
}
