/**
 * Custom (Agent-Created) Tools System
 *
 * Allows the AI agent to create, compile, and register new tools at runtime.
 * Custom tools are stored in the database and loaded on startup.
 *
 * Built-in tool: `nexus_create_tool` — lets the agent define a new tool
 * with a name, description, input schema, and TypeScript implementation.
 * The implementation is compiled and sandboxed for safe execution.
 *
 * Custom tool names are prefixed with `custom.` to avoid collisions.
 *
 * Security:
 *  - Tool creation always requires admin approval
 *  - Tool implementations run in a sandboxed VM context
 *  - Only specific Node.js APIs are whitelisted
 *  - Custom tools can be enabled/disabled individually
 */

import type { ToolDefinition, ToolCall } from "@/lib/llm";
import * as vm from "vm";

function emitCustomToolLog(level: "verbose" | "warning" | "error", args: unknown[]): void {
  try {
    const { addLog } = require("@/lib/db/queries") as { addLog: (log: { level: string; source: string | null; message: string; metadata: string | null }) => void };
    addLog({
      level,
      source: "custom-tool",
      message: "Sandbox console output",
      metadata: JSON.stringify({ args }),
    });
  } catch {
    // Avoid throwing from log path during bootstrapping or tests.
  }
}

// ── Tool Names ────────────────────────────────────────────────

export const CUSTOM_TOOL_PREFIX = "custom.";

export const TOOL_CREATOR_NAME = "builtin.nexus_create_tool";
export const TOOL_LIST_NAME = "builtin.nexus_list_custom_tools";
export const TOOL_DELETE_NAME = "builtin.nexus_delete_custom_tool";

// ── Built-in Tool Definitions ─────────────────────────────────

export const BUILTIN_TOOLMAKER_TOOLS: ToolDefinition[] = [
  {
    name: TOOL_CREATOR_NAME,
    description:
      "Create a new custom tool that extends Nexus's capabilities. " +
      "You provide the tool name, description, input schema (JSON Schema), and TypeScript implementation code. " +
      "The implementation must export a default async function that takes a single `args` object parameter and returns a result. " +
      "Custom tools are sandboxed — you can use fetch(), JSON, Math, Date, RegExp, URLSearchParams, Buffer, " +
      "and console.log. File system and process access is NOT available. " +
      "REQUIRES APPROVAL — an admin must approve tool creation before the tool becomes available.",
    inputSchema: {
      type: "object",
      properties: {
        toolName: {
          type: "string",
          description:
            "Short, descriptive name for the tool using snake_case (e.g., 'calculate_bmi', 'format_date'). " +
            "Will be prefixed with 'custom.' automatically.",
        },
        description: {
          type: "string",
          description:
            "Clear description of what the tool does and when to use it.",
        },
        inputSchema: {
          type: "object",
          description:
            "JSON Schema object describing the tool's input parameters. " +
            "Must have 'type: \"object\"' and 'properties'.",
        },
        implementation: {
          type: "string",
          description:
            "TypeScript/JavaScript implementation code. Must be an async function body " +
            "that receives `args` (the input parameters) and returns a result. " +
            "Example: 'const result = args.a + args.b; return { sum: result };' " +
            "Available globals: fetch, JSON, Math, Date, RegExp, URL, URLSearchParams, Buffer, console, setTimeout, clearTimeout.",
        },
      },
      required: ["toolName", "description", "inputSchema", "implementation"],
    },
  },
  {
    name: TOOL_LIST_NAME,
    description:
      "List all custom tools that have been created. Shows name, description, and enabled status.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: TOOL_DELETE_NAME,
    description:
      "Delete a custom tool by name. REQUIRES APPROVAL.",
    inputSchema: {
      type: "object",
      properties: {
        toolName: {
          type: "string",
          description: "The tool name to delete (with or without the 'custom.' prefix).",
        },
      },
      required: ["toolName"],
    },
  },
];

/** Tools that require approval */
export const CUSTOM_TOOLS_REQUIRING_APPROVAL = [
  TOOL_CREATOR_NAME,
  TOOL_DELETE_NAME,
];

// ── In-Memory Custom Tool Registry ───────────────────────────

interface CustomToolEntry {
  name: string;            // Full name with custom. prefix
  description: string;
  inputSchema: Record<string, unknown>;
  implementation: string;  // Raw code
  enabled: boolean;
  createdAt: string;
}

/** In-memory cache of custom tools. Loaded from DB on startup. */
let customToolsCache: CustomToolEntry[] = [];

// ── DB Operations ─────────────────────────────────────────────

export function loadCustomToolsFromDb(): void {
  try {
    const { listCustomTools } = require("@/lib/db/queries");
    const rows = listCustomTools();
    customToolsCache = rows.map((r: any) => ({
      name: r.name,
      description: r.description,
      inputSchema: JSON.parse(r.input_schema),
      implementation: r.implementation,
      enabled: !!r.enabled,
      createdAt: r.created_at,
    }));
  } catch {
    customToolsCache = [];
  }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Check if a tool name is a custom tool.
 */
export function isCustomTool(name: string): boolean {
  return name.startsWith(CUSTOM_TOOL_PREFIX) ||
    name === TOOL_CREATOR_NAME ||
    name === TOOL_LIST_NAME ||
    name === TOOL_DELETE_NAME;
}

/**
 * Get ToolDefinition[] for all enabled custom tools + the toolmaker tools.
 */
export function getCustomToolDefinitions(): ToolDefinition[] {
  const customDefs: ToolDefinition[] = customToolsCache
    .filter((t) => t.enabled)
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

  return [...BUILTIN_TOOLMAKER_TOOLS, ...customDefs];
}

/**
 * Execute a custom tool (or a toolmaker built-in).
 */
export async function executeCustomTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  // Toolmaker built-ins
  if (name === TOOL_CREATOR_NAME) {
    return createCustomTool(args);
  }
  if (name === TOOL_LIST_NAME) {
    return listTools();
  }
  if (name === TOOL_DELETE_NAME) {
    return deleteCustomTool(args);
  }

  // Custom tool execution
  const tool = customToolsCache.find((t) => t.name === name && t.enabled);
  if (!tool) {
    throw new Error(`Custom tool "${name}" not found or is disabled.`);
  }

  return runSandboxed(tool.implementation, args);
}

// ── Tool Creation ─────────────────────────────────────────────

async function createCustomTool(args: Record<string, unknown>): Promise<unknown> {
  const rawName = args.toolName as string;
  const description = args.description as string;
  const inputSchema = args.inputSchema as Record<string, unknown>;
  const implementation = args.implementation as string;

  if (!rawName || !description || !inputSchema || !implementation) {
    throw new Error("Missing required fields: toolName, description, inputSchema, implementation");
  }

  // Sanitize the name
  const safeName = rawName
    .replace(/^custom\./, "")
    .replace(/[^a-z0-9_]/gi, "_")
    .toLowerCase();
  const fullName = `${CUSTOM_TOOL_PREFIX}${safeName}`;

  // Validate name length
  if (safeName.length < 2 || safeName.length > 64) {
    throw new Error("Tool name must be 2-64 characters.");
  }

  // Check for duplicates
  if (customToolsCache.some((t) => t.name === fullName)) {
    throw new Error(`Custom tool "${fullName}" already exists. Delete it first to recreate.`);
  }

  // Validate the implementation compiles
  try {
    // eslint-disable-next-line no-new
    new Function("args", implementation);
  } catch (err: any) {
    throw new Error(`Implementation code has syntax errors: ${err.message}`);
  }

  // Validate inputSchema has required structure
  if (!inputSchema.type || inputSchema.type !== "object") {
    throw new Error("inputSchema must have type: 'object'");
  }

  // Save to DB
  const { createCustomToolRecord, upsertToolPolicy } = require("@/lib/db/queries");
  createCustomToolRecord({
    name: fullName,
    description,
    inputSchema: JSON.stringify(inputSchema),
    implementation,
  });

  // Auto-create a tool policy so it shows in the policies UI
  upsertToolPolicy({
    tool_name: fullName,
    mcp_id: null,
    requires_approval: 0,
    is_proactive_enabled: 0,
  });

  // Update cache
  customToolsCache.push({
    name: fullName,
    description,
    inputSchema,
    implementation,
    enabled: true,
    createdAt: new Date().toISOString(),
  });

  return {
    status: "created",
    toolName: fullName,
    message: `Custom tool "${fullName}" created successfully. It is now available for use.`,
  };
}

function listTools(): unknown {
  return {
    tools: customToolsCache.map((t) => ({
      name: t.name,
      description: t.description,
      enabled: t.enabled,
      createdAt: t.createdAt,
      inputSchema: t.inputSchema,
    })),
    count: customToolsCache.length,
  };
}

async function deleteCustomTool(args: Record<string, unknown>): Promise<unknown> {
  const rawName = args.toolName as string;
  if (!rawName) throw new Error("toolName is required.");

  const fullName = rawName.startsWith(CUSTOM_TOOL_PREFIX) ? rawName : `${CUSTOM_TOOL_PREFIX}${rawName}`;
  const idx = customToolsCache.findIndex((t) => t.name === fullName);
  if (idx === -1) {
    throw new Error(`Custom tool "${fullName}" not found.`);
  }

  // Remove from DB
  const { deleteCustomToolRecord } = require("@/lib/db/queries");
  deleteCustomToolRecord(fullName);

  // Also remove the tool policy
  try {
    const db = require("@/lib/db/connection").getDb();
    db.prepare("DELETE FROM tool_policies WHERE tool_name = ?").run(fullName);
  } catch (err) {
    emitCustomToolLog("verbose", ["Tool policy cleanup skipped", fullName, err instanceof Error ? err.message : String(err)]);
  }

  // Remove from cache
  customToolsCache.splice(idx, 1);

  return {
    status: "deleted",
    toolName: fullName,
    message: `Custom tool "${fullName}" has been deleted.`,
  };
}

// ── Sandboxed Execution ───────────────────────────────────────

const SANDBOX_TIMEOUT_MS = 30_000; // 30s max execution

/**
 * Execute custom tool code in a VM sandbox with limited globals.
 */
async function runSandboxed(
  code: string,
  args: Record<string, unknown>
): Promise<unknown> {
  // Create a minimal sandbox context
  const sandbox: Record<string, unknown> = {
    // Safe globals
    JSON,
    Math,
    Date,
    RegExp,
    URL,
    URLSearchParams,
    Buffer,
    console: {
      log: (...a: unknown[]) => emitCustomToolLog("verbose", a),
      warn: (...a: unknown[]) => emitCustomToolLog("warning", a),
      error: (...a: unknown[]) => emitCustomToolLog("error", a),
    },
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),

    // Network access (controlled)
    fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,

    // The args passed to the tool
    __args__: args,
    __result__: undefined as unknown,
  };

  vm.createContext(sandbox);

  // Wrap the user code in an async IIFE
  const wrappedCode = `
    (async () => {
      const args = __args__;
      ${code}
    })().then(r => { __result__ = r; }).catch(e => { __result__ = { __error__: e.message || String(e) }; });
  `;

  const script = new vm.Script(wrappedCode, {
    filename: "custom-tool.js",
  });

  script.runInContext(sandbox, { timeout: SANDBOX_TIMEOUT_MS });

  // The wrapped code is async, so we need to wait for the promise
  // Give it up to SANDBOX_TIMEOUT_MS to complete
  const start = Date.now();
  while (sandbox.__result__ === undefined && Date.now() - start < SANDBOX_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const result = sandbox.__result__;
  if (result && typeof result === "object" && "__error__" in (result as Record<string, unknown>)) {
    throw new Error((result as Record<string, unknown>).__error__ as string);
  }

  return result ?? { status: "completed", note: "Tool returned no explicit value." };
}
