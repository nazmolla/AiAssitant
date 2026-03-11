import type { ToolDefinition } from "@/lib/llm";

export const MAX_TOOLS_PER_REQUEST = 128;

export function buildCappedToolList(
  builtinTools: ToolDefinition[],
  customTools: ToolDefinition[],
  mcpTools: ToolDefinition[],
  maxTools: number = MAX_TOOLS_PER_REQUEST,
): ToolDefinition[] {
  const builtinAndCustom = [...builtinTools, ...customTools];
  if (builtinAndCustom.length >= maxTools) {
    return builtinAndCustom.slice(0, maxTools);
  }

  const mcpSlots = maxTools - builtinAndCustom.length;
  return [...builtinAndCustom, ...mcpTools.slice(0, mcpSlots)];
}