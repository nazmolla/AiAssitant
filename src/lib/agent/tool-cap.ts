import type { ToolDefinition } from "@/lib/llm";

export const MAX_TOOLS_PER_REQUEST = 120; // Conservative cap to ensure we never exceed API limits (actual limit is 128)

export function buildCappedToolList(
  builtinTools: ToolDefinition[],
  customTools: ToolDefinition[],
  mcpTools: ToolDefinition[],
  maxTools: number = MAX_TOOLS_PER_REQUEST,
): ToolDefinition[] {
  // Deduplicate by tool name to prevent duplicates from appearing in multiple arrays
  const seenNames = new Set<string>();
  const deduped: ToolDefinition[] = [];

  for (const tool of [...builtinTools, ...customTools, ...mcpTools]) {
    if (!seenNames.has(tool.name)) {
      seenNames.add(tool.name);
      deduped.push(tool);
    }
  }

  // Return up to maxTools; never exceed limit
  return deduped.slice(0, maxTools);
}