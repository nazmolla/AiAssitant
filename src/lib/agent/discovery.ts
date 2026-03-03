import type { ToolDefinition } from "@/lib/llm";
import { getMcpManager } from "@/lib/mcp";
import * as agentExports from "./index";

export interface DiscoveredTool extends ToolDefinition {
  source: "builtin" | "custom" | "mcp";
  group: string;
}

const TOOL_PREFIX_GROUPS: Array<{ prefix: string; group: string }> = [
  { prefix: "builtin.web_", group: "Web Tools" },
  { prefix: "builtin.browser_", group: "Browser Tools" },
  { prefix: "builtin.fs_", group: "File System" },
  { prefix: "builtin.net_", group: "Network Tools" },
  { prefix: "builtin.email_", group: "Email Tools" },
  { prefix: "builtin.file_", group: "File Generation" },
  { prefix: "builtin.nexus_", group: "Tool Management" },
  { prefix: "builtin.alexa_", group: "Alexa Smart Home" },
  { prefix: "custom.", group: "Custom Tools" },
];

function isToolDefinition(value: unknown): value is ToolDefinition {
  return !!value && typeof value === "object" &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { description?: unknown }).description === "string";
}

function isToolDefinitionArray(value: unknown): value is ToolDefinition[] {
  return Array.isArray(value) && value.every(isToolDefinition);
}

function collectExportedToolArrays(namePattern: RegExp): ToolDefinition[] {
  const all: ToolDefinition[] = [];
  for (const [key, value] of Object.entries(agentExports as Record<string, unknown>)) {
    if (!namePattern.test(key)) continue;
    if (!isToolDefinitionArray(value)) continue;
    all.push(...value);
  }
  return all;
}

function collectApprovalRequiredToolNames(): Set<string> {
  const allNames = new Set<string>();
  for (const [key, value] of Object.entries(agentExports as Record<string, unknown>)) {
    if (!/_REQUIRING_APPROVAL$/.test(key)) continue;
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string") allNames.add(item);
    }
  }
  return allNames;
}

const TOOLS_REQUIRING_APPROVAL = collectApprovalRequiredToolNames();

function inferGroup(toolName: string): string {
  for (const entry of TOOL_PREFIX_GROUPS) {
    if (toolName.startsWith(entry.prefix)) return entry.group;
  }
  return "Other";
}

export function getAllBuiltinTools(): ToolDefinition[] {
  const deduped = new Map<string, ToolDefinition>();
  const arrays = collectExportedToolArrays(/^BUILTIN_.*_TOOLS$/);
  for (const tool of arrays) {
    deduped.set(tool.name, tool);
  }
  return Array.from(deduped.values());
}

export function discoverAllTools(): DiscoveredTool[] {
  const builtin = getAllBuiltinTools().map((tool) => ({
    ...tool,
    source: "builtin" as const,
    group: inferGroup(tool.name),
  }));

  const getCustomToolDefinitions = (agentExports as { getCustomToolDefinitions?: () => ToolDefinition[] }).getCustomToolDefinitions;
  const custom = (typeof getCustomToolDefinitions === "function" ? getCustomToolDefinitions() : []).map((tool) => ({
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
  for (const tool of [...builtin, ...custom, ...mcp]) {
    deduped.set(tool.name, tool);
  }
  return Array.from(deduped.values());
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
