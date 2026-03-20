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
import { BaseTool, type ToolExecutionContext, registerToolCategory } from "./base-tool";
import { findDuplicateToolMatch } from "./tool-duplicate-gate";
import * as vm from "vm";
import { spawn } from "child_process";
import path from "path";
import { ValidationError, NotFoundError, IntegrationError } from "@/lib/errors";
import { SANDBOX_TIMEOUT_MS, SANDBOX_VALIDATION_TIMEOUT_MS } from "@/lib/constants";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("tools.custom-tools");

// ── Tool Names ────────────────────────────────────────────────

export const CUSTOM_TOOL_PREFIX = "custom.";

export const TOOL_CREATOR_NAME = "builtin.nexus_create_tool";
export const TOOL_UPDATE_NAME = "builtin.nexus_update_tool";
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
    name: TOOL_UPDATE_NAME,
    description:
      "Update an existing custom tool's code, description, or input schema. " +
      "Use this to fix bugs, improve implementations, or change parameters of a tool you previously created. " +
      "Only the fields you provide will be updated — omit fields you don't want to change. " +
      "The new implementation will be validated in a sandbox dry-run before saving. " +
      "REQUIRES APPROVAL — an admin must approve the update.",
    inputSchema: {
      type: "object",
      properties: {
        toolName: {
          type: "string",
          description:
            "The name of the existing custom tool to update (with or without the 'custom.' prefix).",
        },
        description: {
          type: "string",
          description: "New description for the tool (optional — omit to keep current).",
        },
        inputSchema: {
          type: "object",
          description: "New JSON Schema for input parameters (optional — omit to keep current).",
        },
        implementation: {
          type: "string",
          description:
            "New implementation code (optional — omit to keep current). " +
            "Will be validated via sandbox dry-run before saving.",
        },
      },
      required: ["toolName"],
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
  TOOL_UPDATE_NAME,
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

const FORBIDDEN_GLOBALS = [
  "process", "require", "module", "exports", "__dirname", "__filename",
  "global", "globalThis",
];
const FORBIDDEN_GLOBAL_PATTERN = new RegExp(
  `\\b(${FORBIDDEN_GLOBALS.join("|")})\\b`
);

class CustomToolRuntime {
  static emitCustomToolLog(level: "verbose" | "warning" | "error", args: unknown[]): void {
    try {
      const { addLog } = require("@/lib/db/queries") as { addLog: (log: { level: string; source: string | null; message: string; metadata: string | null }) => void };
      addLog({
        level,
        source: "custom-tool",
        message: "Sandbox console output",
        metadata: JSON.stringify({ args }),
      });
    } catch {
    }
  }

  static loadCustomToolsFromDb(): void {
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

  static isCustomTool(name: string): boolean {
    return name.startsWith(CUSTOM_TOOL_PREFIX) ||
      name === TOOL_CREATOR_NAME ||
      name === TOOL_UPDATE_NAME ||
      name === TOOL_LIST_NAME ||
      name === TOOL_DELETE_NAME;
  }

  static getCustomToolDefinitions(): ToolDefinition[] {
    const customDefs: ToolDefinition[] = customToolsCache
      .filter((t) => t.enabled)
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

    return [...BUILTIN_TOOLMAKER_TOOLS, ...customDefs];
  }

  static async executeCustomTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const t0 = Date.now();
    log.enter("executeCustomTool", { name });
    if (name === TOOL_CREATOR_NAME) {
      return CustomToolRuntime.createCustomTool(args);
    }
    if (name === TOOL_UPDATE_NAME) {
      return CustomToolRuntime.updateCustomTool(args);
    }
    if (name === TOOL_LIST_NAME) {
      return CustomToolRuntime.listTools();
    }
    if (name === TOOL_DELETE_NAME) {
      return CustomToolRuntime.deleteCustomTool(args);
    }

    const tool = customToolsCache.find((t) => t.name === name && t.enabled);
    if (!tool) {
      log.error(`Custom tool "${name}" not found or is disabled`, { name });
      throw new NotFoundError(`Custom tool "${name}" not found or is disabled.`);
    }

    try {
      const result = await CustomToolRuntime.runSandboxed(tool.implementation, args);
      log.exit("executeCustomTool", { name }, Date.now() - t0);
      return result;
    } catch (err) {
      log.error(`Custom tool "${name}" failed`, { name }, err);
      throw err;
    }
  }

  static async createCustomTool(args: Record<string, unknown>): Promise<unknown> {
    const rawName = args.toolName as string;
    const description = args.description as string;
    const inputSchema = args.inputSchema as Record<string, unknown>;
    const implementation = args.implementation as string;

    if (!rawName || !description || !inputSchema || !implementation) {
      throw new ValidationError("Missing required fields: toolName, description, inputSchema, implementation");
    }

    const safeName = rawName
      .replace(/^custom\./, "")
      .replace(/[^a-z0-9_]/gi, "_")
      .toLowerCase();
    const fullName = `${CUSTOM_TOOL_PREFIX}${safeName}`;

    if (safeName.length < 2 || safeName.length > 64) {
      throw new ValidationError("Tool name must be 2-64 characters.");
    }

    if (customToolsCache.some((t) => t.name === fullName)) {
      throw new ValidationError(
        `Custom tool "${fullName}" already exists. ` +
        `Use builtin.nexus_update_tool to modify its implementation, description, or schema.`
      );
    }

    const architectureTools = await CustomToolRuntime.getArchitectureToolDefinitions();
    const duplicate = findDuplicateToolMatch(
      {
        name: fullName,
        description,
        inputSchema,
      },
      architectureTools,
    );
    if (duplicate) {
      throw new ValidationError(
        `Custom tool is too similar to existing tool "${duplicate.toolName}" (score: ${duplicate.score.toFixed(2)}). ` +
        `Use builtin.nexus_update_tool to evolve the existing tool instead of creating a duplicate.`
      );
    }

    if (!inputSchema.type || inputSchema.type !== "object") {
      throw new ValidationError("inputSchema must have type: 'object'");
    }

    const validationError = CustomToolRuntime.validateImplementation(implementation);
    if (validationError) {
      throw new ValidationError(validationError);
    }

    const { createCustomToolRecord, upsertToolPolicy } = require("@/lib/db/queries");
    createCustomToolRecord({
      name: fullName,
      description,
      inputSchema: JSON.stringify(inputSchema),
      implementation,
    });

    upsertToolPolicy({
      tool_name: fullName,
      mcp_id: null,
      requires_approval: 0,
      scope: "global",
    });

    customToolsCache.push({
      name: fullName,
      description,
      inputSchema,
      implementation,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    log.info(`Custom tool "${fullName}" created successfully`, { fullName });
    return {
      status: "created",
      toolName: fullName,
      message: `Custom tool "${fullName}" created successfully. It is now available for use.`,
    };
  }

  static async updateCustomTool(args: Record<string, unknown>): Promise<unknown> {
    const rawName = args.toolName as string;
    if (!rawName) throw new ValidationError("toolName is required.");

    const fullName = rawName.startsWith(CUSTOM_TOOL_PREFIX) ? rawName : `${CUSTOM_TOOL_PREFIX}${rawName}`;
    const idx = customToolsCache.findIndex((t) => t.name === fullName);
    if (idx === -1) {
      throw new NotFoundError(`Custom tool "${fullName}" not found. Use builtin.nexus_create_tool to create it first.`);
    }

    const existing = customToolsCache[idx];
    const newDescription = typeof args.description === "string" ? args.description : existing.description;
    const newInputSchema = (args.inputSchema && typeof args.inputSchema === "object")
      ? args.inputSchema as Record<string, unknown>
      : existing.inputSchema;
    const newImplementation = typeof args.implementation === "string" ? args.implementation : existing.implementation;

    if (args.inputSchema) {
      if (!newInputSchema.type || newInputSchema.type !== "object") {
        throw new ValidationError("inputSchema must have type: 'object'");
      }
    }

    if (typeof args.implementation === "string") {
      const validationError = CustomToolRuntime.validateImplementation(newImplementation);
      if (validationError) {
        throw new ValidationError(validationError);
      }
    }

    const { updateCustomToolRecord } = require("@/lib/db/queries");
    updateCustomToolRecord(fullName, {
      description: newDescription,
      inputSchema: JSON.stringify(newInputSchema),
      implementation: newImplementation,
    });

    customToolsCache[idx] = {
      ...existing,
      description: newDescription,
      inputSchema: newInputSchema,
      implementation: newImplementation,
    };

    const changed: string[] = [];
    if (typeof args.description === "string") changed.push("description");
    if (args.inputSchema) changed.push("inputSchema");
    if (typeof args.implementation === "string") changed.push("implementation");

    return {
      status: "updated",
      toolName: fullName,
      fieldsUpdated: changed,
      message: `Custom tool "${fullName}" updated successfully (${changed.join(", ")}).`,
    };
  }

  static listTools(): unknown {
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

  static async getArchitectureToolDefinitions(): Promise<ToolDefinition[]> {
    try {
      const { discoverAllTools } = await import("@/lib/agent/discovery");
      return discoverAllTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    } catch {
      return CustomToolRuntime.getCustomToolDefinitions();
    }
  }

  static async deleteCustomTool(args: Record<string, unknown>): Promise<unknown> {
    const rawName = args.toolName as string;
    if (!rawName) throw new ValidationError("toolName is required.");

    const fullName = rawName.startsWith(CUSTOM_TOOL_PREFIX) ? rawName : `${CUSTOM_TOOL_PREFIX}${rawName}`;
    const idx = customToolsCache.findIndex((t) => t.name === fullName);
    if (idx === -1) {
      throw new NotFoundError(`Custom tool "${fullName}" not found.`);
    }

    const { deleteCustomToolRecord } = require("@/lib/db/queries");
    deleteCustomToolRecord(fullName);

    try {
      const db = require("@/lib/db/connection").getDb();
      db.prepare("DELETE FROM tool_policies WHERE tool_name = ?").run(fullName);
    } catch (err) {
      CustomToolRuntime.emitCustomToolLog("verbose", ["Tool policy cleanup skipped", fullName, err instanceof Error ? err.message : String(err)]);
    }

    customToolsCache.splice(idx, 1);

    return {
      status: "deleted",
      toolName: fullName,
      message: `Custom tool "${fullName}" has been deleted.`,
    };
  }

  static buildSandboxContext(args: Record<string, unknown>): Record<string, unknown> {
    return {
      JSON,
      Math,
      Date,
      RegExp,
      URL,
      URLSearchParams,
      Buffer,
      console: {
        log: (...a: unknown[]) => CustomToolRuntime.emitCustomToolLog("verbose", a),
        warn: (...a: unknown[]) => CustomToolRuntime.emitCustomToolLog("warning", a),
        error: (...a: unknown[]) => CustomToolRuntime.emitCustomToolLog("error", a),
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
      fetch: globalThis.fetch,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      __args__: args,
      __result__: undefined as unknown,
    };
  }

  static validateImplementation(code: string): string | null {
    const forbiddenMatch = code.match(FORBIDDEN_GLOBAL_PATTERN);
    if (forbiddenMatch) {
      return (
        `Implementation code references "${forbiddenMatch[1]}" which is not available in the sandbox. ` +
        `Available globals: fetch, JSON, Math, Date, RegExp, URL, URLSearchParams, Buffer, console, setTimeout, clearTimeout, ` +
        `parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, atob, btoa.`
      );
    }

    try {
      new Function("args", `return (async () => { ${code} })();`);
    } catch (err: any) {
      return `Implementation code has syntax errors: ${err.message}`;
    }

    const sandbox = CustomToolRuntime.buildSandboxContext({});
    vm.createContext(sandbox);

    const wrappedCode = `
    (async () => {
      const args = __args__;
      ${code}
    })().then(r => { __result__ = r; }).catch(e => { __result__ = { __error__: e.message || String(e) }; });
  `;

    try {
      const script = new vm.Script(wrappedCode, { filename: "custom-tool-validate.js" });
      script.runInContext(sandbox, { timeout: SANDBOX_VALIDATION_TIMEOUT_MS });
    } catch (err: any) {
      return `Implementation code failed sandbox compilation: ${err.message}`;
    }

    return null;
  }

  static async runSandboxed(
    code: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // Run in an isolated child process with an empty environment so that
    // parent process secrets (env vars, DB connections) are not accessible.
    // This prevents constructor-chain prototype escapes from reaching sensitive state.
    return new Promise((resolve, reject) => {
      const runnerPath = path.resolve(process.cwd(), "scripts/sandbox-runner.cjs");
      const child = spawn(process.execPath, [runnerPath], {
        env: { SANDBOX_TIMEOUT: String(SANDBOX_TIMEOUT_MS), NODE_ENV: "production" }, // minimal env — no inherited secrets
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      const killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new IntegrationError("Custom tool sandbox timed out"));
      }, SANDBOX_TIMEOUT_MS + 2000);

      child.on("close", () => {
        clearTimeout(killTimer);
        try {
          const parsed = JSON.parse(stdout || "{}") as { result?: unknown; error?: string; logs?: { level: string; msg: string }[] };
          // Relay sandbox console logs
          for (const entry of parsed.logs ?? []) {
            CustomToolRuntime.emitCustomToolLog(entry.level as "verbose" | "warning" | "error", [entry.msg]);
          }
          if (parsed.error) {
            reject(new IntegrationError(parsed.error));
          } else {
            resolve(parsed.result ?? { status: "completed", note: "Tool returned no explicit value." });
          }
        } catch {
          reject(new IntegrationError(`Sandbox runner returned invalid output: ${stderr || stdout}`));
        }
      });

      child.on("error", (err) => {
        clearTimeout(killTimer);
        reject(new IntegrationError(`Failed to start sandbox runner: ${err.message}`));
      });

      // Send code and args to the child via stdin
      child.stdin.write(JSON.stringify({ code, args }));
      child.stdin.end();
    });
  }
}

// ── DB Operations ─────────────────────────────────────────────

export const loadCustomToolsFromDb = CustomToolRuntime.loadCustomToolsFromDb.bind(CustomToolRuntime);

// ── Public API ────────────────────────────────────────────────

/**
 * Check if a tool name is a custom tool.
 */
export const isCustomTool = CustomToolRuntime.isCustomTool.bind(CustomToolRuntime);

/**
 * Get ToolDefinition[] for all enabled custom tools + the toolmaker tools.
 */
export const getCustomToolDefinitions = CustomToolRuntime.getCustomToolDefinitions.bind(CustomToolRuntime);

/**
 * Execute a custom tool (or a toolmaker built-in).
 */
export const executeCustomTool = CustomToolRuntime.executeCustomTool.bind(CustomToolRuntime);
export const validateImplementation = CustomToolRuntime.validateImplementation.bind(CustomToolRuntime);

// ── BaseTool class wrapper ────────────────────────────────────

export class CustomTools extends BaseTool {
  readonly name = "custom";
  readonly toolNamePrefix = "custom.";
  readonly registrationOrder = 1000;
  readonly toolsRequiringApproval = [...CUSTOM_TOOLS_REQUIRING_APPROVAL];

  /** Dynamic: includes both toolmaker meta-tools and user-created tools */
  get tools(): ToolDefinition[] {
    return CustomToolRuntime.getCustomToolDefinitions();
  }

  /** Custom matcher — handles both custom.* prefix and builtin toolmaker tools */
  matches(toolName: string): boolean {
    return CustomToolRuntime.isCustomTool(toolName);
  }

  async execute(toolName: string, args: Record<string, unknown>, _context: ToolExecutionContext): Promise<unknown> {
    return CustomToolRuntime.executeCustomTool(toolName, args);
  }
}

export const customTools = new CustomTools();
registerToolCategory(customTools);
