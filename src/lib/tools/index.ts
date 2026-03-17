/**
 * Tools barrel export.
 *
 * Tool categories self-register via `registerToolCategory()` at module
 * scope (side-effect of the re-export imports below). ALL_TOOL_CATEGORIES
 * is auto-discovered from the registry — no manual array to maintain.
 *
 * To add a new tool category:
 *   1. Create `src/lib/tools/my-tools.ts` extending `BaseTool`
 *   2. Set `registrationOrder` (dispatch priority; lower = matched first)
 *   3. Call `registerToolCategory(myTools)` after the singleton export
 *   4. Add a re-export line here for named imports
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/132
 */

export {
  BaseTool,
  type ToolCategory,
  type ToolExecutionContext,
  registerToolCategory,
  getRegisteredToolCategories,
  resetToolCategoryRegistry,
} from "./base-tool";

export { webTools, WebTools, BUILTIN_WEB_TOOLS, isBuiltinWebTool, executeBuiltinWebTool } from "./web-tools";
export { browserTools, BrowserTools, BUILTIN_BROWSER_TOOLS, isBrowserTool, executeBrowserTool, BROWSER_TOOLS_REQUIRING_APPROVAL } from "./browser-tools";
export { fsTools, FsTools, BUILTIN_FS_TOOLS, isFsTool, executeBuiltinFsTool, FS_TOOLS_REQUIRING_APPROVAL, FS_TOOL_NAMES } from "./fs-tools";
export { networkTools, NetworkTools, BUILTIN_NETWORK_TOOLS, isNetworkTool, executeBuiltinNetworkTool, NETWORK_TOOLS_REQUIRING_APPROVAL, NET_TOOL_NAMES } from "./network-tools";
export { emailTools, EmailTools, BUILTIN_EMAIL_TOOLS, isEmailTool, executeBuiltinEmailTool, EMAIL_TOOLS_REQUIRING_APPROVAL, EMAIL_TOOL_NAMES } from "./email-tools";
export { phoneTools, PhoneTools, BUILTIN_PHONE_TOOLS, isPhoneTool, executeBuiltinPhoneTool, PHONE_TOOLS_REQUIRING_APPROVAL, PHONE_TOOL_NAMES } from "./phone-tools";
export { fileTools, FileTools, BUILTIN_FILE_TOOLS, isFileTool, executeBuiltinFileTool, FILE_TOOLS_REQUIRING_APPROVAL, FILE_TOOL_NAMES } from "./file-tools";
export {
  customTools, CustomTools,
  isCustomTool, executeCustomTool, getCustomToolDefinitions, loadCustomToolsFromDb,
  validateImplementation, BUILTIN_TOOLMAKER_TOOLS, CUSTOM_TOOLS_REQUIRING_APPROVAL,
  CUSTOM_TOOL_PREFIX, TOOL_CREATOR_NAME,
} from "./custom-tools";
export { alexaTools, AlexaTools, BUILTIN_ALEXA_TOOLS, isAlexaTool, executeAlexaTool, ALEXA_TOOLS_REQUIRING_APPROVAL } from "./alexa-tools";
export { getAlexaConfig, saveAlexaConfig } from "./alexa-tools";
export { PromptTool, type PromptToolConfig } from "./prompt-tool";
export {
  workflowTools, WorkflowTools, BUILTIN_WORKFLOW_TOOLS, isWorkflowTool,
  WORKFLOW_TOOLS_REQUIRING_APPROVAL,
} from "./workflow-tools";
export { proactiveScanTool, ProactiveScanTool } from "./proactive-scan-tool";
export { knowledgeMaintenanceTool, KnowledgeMaintenanceTool } from "./knowledge-maintenance-tool";
export { dbMaintenanceTool, DbMaintenanceTool } from "./db-maintenance-tool";
export { emailReadTool, EmailReadTool } from "./email-tools";
export { dispatchAgentTool, DispatchAgentTool } from "./dispatch-agent-tool";

export { buildCappedToolList, MAX_TOOLS_PER_REQUEST } from "./tool-cap";

// ── Auto-discovered tool categories ───────────────────────────
//
// Each *-tools.ts module self-registers via registerToolCategory()
// as a side-effect of the re-export imports above.
// No manual array — just sorted by registrationOrder.

import { getRegisteredToolCategories, type BaseTool } from "./base-tool";

/**
 * All built-in tool categories in dispatch order (auto-discovered).
 * MCP (catch-all) is handled separately by the registry.
 */
export const ALL_TOOL_CATEGORIES: BaseTool[] = getRegisteredToolCategories();
