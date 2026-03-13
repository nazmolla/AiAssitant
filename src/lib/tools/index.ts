/**
 * Tools barrel export — auto-discovery entry point.
 *
 * ALL_TOOL_CATEGORIES is the single list of built-in tool categories
 * in registration order.  The registry loops over this array to
 * register categories — no manual adapter objects required.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/132
 */

export { BaseTool, type ToolCategory, type ToolExecutionContext } from "./base-tool";

export { webTools, WebTools, BUILTIN_WEB_TOOLS, isBuiltinWebTool, executeBuiltinWebTool } from "./web-tools";
export { browserTools, BrowserTools, BUILTIN_BROWSER_TOOLS, isBrowserTool, executeBrowserTool, BROWSER_TOOLS_REQUIRING_APPROVAL } from "./browser-tools";
export { fsTools, FsTools, BUILTIN_FS_TOOLS, isFsTool, executeBuiltinFsTool, FS_TOOLS_REQUIRING_APPROVAL, FS_TOOL_NAMES } from "./fs-tools";
export { networkTools, NetworkTools, BUILTIN_NETWORK_TOOLS, isNetworkTool, executeBuiltinNetworkTool, NETWORK_TOOLS_REQUIRING_APPROVAL, NET_TOOL_NAMES } from "./network-tools";
export { emailTools, EmailTools, BUILTIN_EMAIL_TOOLS, isEmailTool, executeBuiltinEmailTool, EMAIL_TOOLS_REQUIRING_APPROVAL, EMAIL_TOOL_NAMES } from "./email-tools";
export { fileTools, FileTools, BUILTIN_FILE_TOOLS, isFileTool, executeBuiltinFileTool, FILE_TOOLS_REQUIRING_APPROVAL, FILE_TOOL_NAMES } from "./file-tools";
export {
  customTools, CustomTools,
  isCustomTool, executeCustomTool, getCustomToolDefinitions, loadCustomToolsFromDb,
  validateImplementation, BUILTIN_TOOLMAKER_TOOLS, CUSTOM_TOOLS_REQUIRING_APPROVAL,
  CUSTOM_TOOL_PREFIX, TOOL_CREATOR_NAME,
} from "./custom-tools";
export { alexaTools, AlexaTools, BUILTIN_ALEXA_TOOLS, isAlexaTool, executeAlexaTool, ALEXA_TOOLS_REQUIRING_APPROVAL } from "./alexa-tools";
export { getAlexaConfig, saveAlexaConfig } from "./alexa-tools";

export { buildCappedToolList, MAX_TOOLS_PER_REQUEST } from "./tool-cap";

// ── Auto-discovery list ───────────────────────────────────────

import { webTools } from "./web-tools";
import { browserTools } from "./browser-tools";
import { fsTools } from "./fs-tools";
import { networkTools } from "./network-tools";
import { emailTools } from "./email-tools";
import { fileTools } from "./file-tools";
import { alexaTools } from "./alexa-tools";
import { customTools } from "./custom-tools";
import type { BaseTool } from "./base-tool";

/**
 * All built-in tool categories in registration order.
 * MCP (catch-all) is handled separately by the registry.
 */
export const ALL_TOOL_CATEGORIES: BaseTool[] = [
  webTools,
  browserTools,
  fsTools,
  networkTools,
  emailTools,
  fileTools,
  alexaTools,
  customTools,
];
