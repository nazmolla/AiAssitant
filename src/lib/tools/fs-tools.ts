/**
 * Built-in File System Tools for Nexus Agent
 *
 * Provides capabilities for interacting with the local file system:
 *  1. fs_read_file         — Read a file's contents
 *  2. fs_read_directory    — List contents of a directory
 *  3. fs_create_file       — Create a new file (safe — won't overwrite)
 *  4. fs_update_file       — Modify an existing file                  [REQUIRES APPROVAL]
 *  5. fs_delete_file       — Delete a file                            [REQUIRES APPROVAL]
 *  6. fs_delete_directory  — Delete a directory                       [REQUIRES APPROVAL]
 *  7. fs_execute_script    — Execute a shell script or command        [REQUIRES APPROVAL]
 *  8. fs_file_info         — Get metadata about a file (size, dates, permissions)
 *  9. fs_search_files      — Recursively search for files by name/pattern
 * 10. fs_extract_text      — Extract readable text from HTML/XML/text files
 *
 * Destructive operations (update, delete, execute) are wired with HITL
 * approval policies by default.
 */

import type { ToolDefinition } from "@/lib/llm";
import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import JSZip from "jszip";
import { exec } from "child_process";
import { promisify } from "util";
import { env } from "@/lib/env";
import { BaseTool, type ToolExecutionContext, registerToolCategory } from "./base-tool";
import {
  FS_MAX_READ_BYTES,
  FS_MAX_SCRIPT_OUTPUT,
  FS_SCRIPT_TIMEOUT_MS,
  FS_DEFAULT_CHUNK_BYTES,
  FS_EXTRACT_DEFAULT_BYTES,
  FS_EXTRACT_DEFAULT_MAX_CHARS,
  FS_EXTRACT_MAX_CHARS_LIMIT,
  FS_WALK_DIR_LIMIT,
} from "@/lib/constants";

const execAsync = promisify(exec);

// ── Tool Names ────────────────────────────────────────────────

export const FS_TOOL_NAMES = {
  READ_FILE: "builtin.fs_read_file",
  EXTRACT_TEXT: "builtin.fs_extract_text",
  READ_DIR: "builtin.fs_read_directory",
  CREATE_FILE: "builtin.fs_create_file",
  UPDATE_FILE: "builtin.fs_update_file",
  DELETE_FILE: "builtin.fs_delete_file",
  DELETE_DIR: "builtin.fs_delete_directory",
  EXECUTE_SCRIPT: "builtin.fs_execute_script",
  FILE_INFO: "builtin.fs_file_info",
  SEARCH_FILES: "builtin.fs_search_files",
} as const;

/** Tools that require owner approval before execution. */
export const FS_TOOLS_REQUIRING_APPROVAL = [
  FS_TOOL_NAMES.CREATE_FILE,
  FS_TOOL_NAMES.UPDATE_FILE,
  FS_TOOL_NAMES.DELETE_FILE,
  FS_TOOL_NAMES.DELETE_DIR,
  FS_TOOL_NAMES.EXECUTE_SCRIPT,
];

// ── Tool Definitions ──────────────────────────────────────────

export const BUILTIN_FS_TOOLS: ToolDefinition[] = [
  // ── Read Operations (no approval) ──────────────────────────
  {
    name: FS_TOOL_NAMES.READ_FILE,
    description:
      "Read the contents of a file from the file system. Returns the text content. Use this to inspect config files, logs, source code, etc. For large files, use startLine/endLine (line-based) or offset/length (byte-based) to read in chunks.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Absolute or relative path to the file to read.",
        },
        encoding: {
          type: "string",
          description: "Text encoding (default: 'utf-8'). Use 'base64' for binary files.",
        },
        startLine: {
          type: "number",
          description: "Optional 1-based start line to read from (for large files).",
        },
        endLine: {
          type: "number",
          description: "Optional 1-based end line to read to (for large files).",
        },
        offset: {
          type: "number",
          description: "Optional byte offset to start reading from (0-based). Use with 'length' for byte-level chunked reading of very large or minified files.",
        },
        length: {
          type: "number",
          description: "Optional number of bytes to read starting from offset. Default: 65536 (64 KB). Max: 1 MB.",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: FS_TOOL_NAMES.EXTRACT_TEXT,
    description:
      "Extract readable plain text from HTML/XML/text files. Useful for large minified HTML where line-based reading is not practical. Supports byte-chunked reads via offset/length.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Absolute or relative path to the file.",
        },
        offset: {
          type: "number",
          description: "Optional byte offset to start reading from (0-based).",
        },
        length: {
          type: "number",
          description: `Optional number of bytes to read from offset. Default ${FS_EXTRACT_DEFAULT_BYTES} (256 KB), max 1 MB.`,
        },
        maxChars: {
          type: "number",
          description: `Maximum output characters after extraction (default ${FS_EXTRACT_DEFAULT_MAX_CHARS}, max ${FS_EXTRACT_MAX_CHARS_LIMIT}).`,
        },
        encoding: {
          type: "string",
          description: "Text encoding (default: 'utf-8').",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: FS_TOOL_NAMES.READ_DIR,
    description:
      "List the contents of a directory. Returns file/folder names, sizes, and types. Use this to explore the file system structure.",
    inputSchema: {
      type: "object",
      properties: {
        dirPath: {
          type: "string",
          description: "Absolute or relative path to the directory.",
        },
        recursive: {
          type: "boolean",
          description: "If true, list contents recursively (default: false). Limited to " + FS_WALK_DIR_LIMIT + " entries.",
        },
        pattern: {
          type: "string",
          description: "Optional glob-like pattern to filter results (e.g. '*.ts', '*.json').",
        },
      },
      required: ["dirPath"],
    },
  },
  {
    name: FS_TOOL_NAMES.FILE_INFO,
    description:
      "Get metadata about a file or directory — size, creation date, modification date, permissions, and whether it is a file or directory.",
    inputSchema: {
      type: "object",
      properties: {
        targetPath: {
          type: "string",
          description: "Absolute or relative path to the file or directory.",
        },
      },
      required: ["targetPath"],
    },
  },
  {
    name: FS_TOOL_NAMES.SEARCH_FILES,
    description:
      "Recursively search for files matching a name pattern under a given directory. Returns matching file paths.",
    inputSchema: {
      type: "object",
      properties: {
        dirPath: {
          type: "string",
          description: "Root directory to start searching from.",
        },
        pattern: {
          type: "string",
          description: "File name pattern to match (supports * and ? wildcards, e.g. '*.log', 'config*').",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return (default 50, max 200).",
        },
      },
      required: ["dirPath", "pattern"],
    },
  },

  // ── Create (no approval by default — safe, won't overwrite) ─
  {
    name: FS_TOOL_NAMES.CREATE_FILE,
    description:
      "Create a new file with the given content. Parent directories are created automatically. Fails if the file already exists (will NOT overwrite). Use fs_update_file to modify existing files.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Path where the new file should be created.",
        },
        content: {
          type: "string",
          description: "The text content to write to the file.",
        },
        encoding: {
          type: "string",
          description: "Text encoding (default: 'utf-8'). Use 'base64' if content is base64-encoded binary.",
        },
      },
      required: ["filePath", "content"],
    },
  },

  // ── Destructive / Mutating (require approval) ──────────────
  {
    name: FS_TOOL_NAMES.UPDATE_FILE,
    description:
      "Update / overwrite an existing file's content. Can replace the entire file or perform a targeted search-and-replace. REQUIRES OWNER APPROVAL.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Path to the file to update.",
        },
        content: {
          type: "string",
          description: "The full new content for the file. Provide this for a full overwrite.",
        },
        search: {
          type: "string",
          description: "Text to find in the existing file (for targeted replace). Use with 'replace'.",
        },
        replace: {
          type: "string",
          description: "Replacement text for the search match.",
        },
        appendContent: {
          type: "string",
          description: "Text to append to the end of the file (alternative to full overwrite).",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: FS_TOOL_NAMES.DELETE_FILE,
    description:
      "Permanently delete a file from the file system. This action is irreversible. REQUIRES OWNER APPROVAL.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Path to the file to delete.",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: FS_TOOL_NAMES.DELETE_DIR,
    description:
      "Permanently delete a directory and all its contents recursively. This action is irreversible. REQUIRES OWNER APPROVAL.",
    inputSchema: {
      type: "object",
      properties: {
        dirPath: {
          type: "string",
          description: "Path to the directory to delete.",
        },
      },
      required: ["dirPath"],
    },
  },
  {
    name: FS_TOOL_NAMES.EXECUTE_SCRIPT,
    description:
      "Execute a shell command or script file on the local system. Returns stdout, stderr, and exit code. REQUIRES OWNER APPROVAL. Use this for running build scripts, installers, automation tasks, etc.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The shell command to execute (e.g. 'npm install', 'python script.py', 'dir /s').",
        },
        cwd: {
          type: "string",
          description: "Working directory for the command (default: current working directory).",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000). Max 120000.",
        },
        shell: {
          type: "string",
          description:
            "Shell to use (default: system default — PowerShell on Windows, bash on Linux/Mac).",
        },
      },
      required: ["command"],
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────

/**
 * Allowed root directory for all FS operations.
 * Defaults to cwd, can be overridden via FS_ALLOWED_ROOT env var.
 */
const FS_ALLOWED_ROOT = env.FS_ALLOWED_ROOT;

// ── BaseTool class wrapper ────────────────────────────────────

export class FsTools extends BaseTool {
  readonly name = "fs";
  readonly toolNamePrefix = "builtin.fs_";
  readonly registrationOrder = 20;
  readonly tools = BUILTIN_FS_TOOLS;
  readonly toolsRequiringApproval = [...FS_TOOLS_REQUIRING_APPROVAL];

  private readonly cmdMap: ReadonlyMap<string, (a: Record<string, unknown>) => Promise<unknown>>;

  constructor() {
    super();
    this.cmdMap = new Map<string, (a: Record<string, unknown>) => Promise<unknown>>([
      [FS_TOOL_NAMES.READ_FILE,      (a) => this.readFile(a)],
      [FS_TOOL_NAMES.EXTRACT_TEXT,   (a) => this.extractText(a)],
      [FS_TOOL_NAMES.READ_DIR,       (a) => this.readDirectory(a)],
      [FS_TOOL_NAMES.FILE_INFO,      (a) => this.fileInfo(a)],
      [FS_TOOL_NAMES.SEARCH_FILES,   (a) => this.searchFiles(a)],
      [FS_TOOL_NAMES.CREATE_FILE,    (a) => this.createFile(a)],
      [FS_TOOL_NAMES.UPDATE_FILE,    (a) => this.updateFile(a)],
      [FS_TOOL_NAMES.DELETE_FILE,    (a) => this.deleteFile(a)],
      [FS_TOOL_NAMES.DELETE_DIR,     (a) => this.deleteDirectory(a)],
      [FS_TOOL_NAMES.EXECUTE_SCRIPT, (a) => this.executeScript(a)],
    ]);
  }

  static isTool(name: string): boolean {
    return Object.values(FS_TOOL_NAMES).includes(name as any);
  }

  static async executeBuiltin(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case FS_TOOL_NAMES.READ_FILE:
        return FsTools.fsReadFile(args);
      case FS_TOOL_NAMES.EXTRACT_TEXT:
        return FsTools.fsExtractText(args);
      case FS_TOOL_NAMES.READ_DIR:
        return FsTools.fsReadDirectory(args);
      case FS_TOOL_NAMES.FILE_INFO:
        return FsTools.fsFileInfo(args);
      case FS_TOOL_NAMES.SEARCH_FILES:
        return FsTools.fsSearchFiles(args);
      case FS_TOOL_NAMES.CREATE_FILE:
        return FsTools.fsCreateFile(args);
      case FS_TOOL_NAMES.UPDATE_FILE:
        return FsTools.fsUpdateFile(args);
      case FS_TOOL_NAMES.DELETE_FILE:
        return FsTools.fsDeleteFile(args);
      case FS_TOOL_NAMES.DELETE_DIR:
        return FsTools.fsDeleteDirectory(args);
      case FS_TOOL_NAMES.EXECUTE_SCRIPT:
        return FsTools.fsExecuteScript(args);
      default:
        throw new Error(`Unknown built-in fs tool: "${name}"`);
    }
  }

  async execute(toolName: string, args: Record<string, unknown>, _context: ToolExecutionContext): Promise<unknown> {
    const handler = this.cmdMap.get(toolName);
    if (!handler) throw new Error(`Unknown built-in fs tool: "${toolName}"`);
    return handler(args);
  }

  private readFile(args: Record<string, unknown>): Promise<unknown>        { return FsTools.fsReadFile(args); }
  private extractText(args: Record<string, unknown>): Promise<unknown>     { return FsTools.fsExtractText(args); }
  private readDirectory(args: Record<string, unknown>): Promise<unknown>   { return FsTools.fsReadDirectory(args); }
  private fileInfo(args: Record<string, unknown>): Promise<unknown>        { return FsTools.fsFileInfo(args); }
  private searchFiles(args: Record<string, unknown>): Promise<unknown>     { return FsTools.fsSearchFiles(args); }
  private createFile(args: Record<string, unknown>): Promise<unknown>      { return FsTools.fsCreateFile(args); }
  private updateFile(args: Record<string, unknown>): Promise<unknown>      { return FsTools.fsUpdateFile(args); }
  private deleteFile(args: Record<string, unknown>): Promise<unknown>      { return FsTools.fsDeleteFile(args); }
  private deleteDirectory(args: Record<string, unknown>): Promise<unknown> { return FsTools.fsDeleteDirectory(args); }
  private executeScript(args: Record<string, unknown>): Promise<unknown>   { return FsTools.fsExecuteScript(args); }

  // ── Path / Pattern Helpers ────────────────────────────────────

  /**
   * Resolve a path, making relative paths relative to cwd,
   * then enforce that the result is within FS_ALLOWED_ROOT.
   */
  private static resolvePath(p: string): string {
    const resolved = path.resolve(p);
    // Resolve symlinks to prevent symlink-based path traversal
    let realResolved: string;
    try {
      realResolved = fs.realpathSync(resolved);
    } catch {
      // File may not exist yet (e.g., create operation) — check parent
      const parentDir = path.dirname(resolved);
      try {
        const realParent = fs.realpathSync(parentDir);
        if (
          !realParent.startsWith(FS_ALLOWED_ROOT + path.sep) &&
          realParent !== FS_ALLOWED_ROOT
        ) {
          throw new Error(
            `Access denied: path "${p}" resolves outside the allowed root directory.`
          );
        }
      } catch (parentErr: any) {
        if (parentErr.message?.startsWith("Access denied")) throw parentErr;
        // Parent doesn't exist either — fall through to normal check
      }
      realResolved = resolved;
    }
    // Normalise both to use consistent separators
    const normalised = path.normalize(realResolved);
    if (
      !normalised.startsWith(FS_ALLOWED_ROOT + path.sep) &&
      normalised !== FS_ALLOWED_ROOT
    ) {
      throw new Error(
        `Access denied: path "${p}" is outside the allowed root directory.`
      );
    }
    return resolved;
  }

  /** Simple glob-like pattern matching (supports * and ?). */
  private static matchPattern(name: string, pattern: string): boolean {
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/([.+^${}()|[\]\\])/g, "\\$1")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$",
      "i"
    );
    return regex.test(name);
  }

  /** Recursively walk a directory, collecting entries (async, bounded). */
  private static async walkDirAsync(
    dir: string,
    pattern: string | undefined,
    maxEntries: number,
    results: Array<{ path: string; type: "file" | "directory"; size: number }>,
    level = 0
  ): Promise<void> {
    if (results.length >= maxEntries || level > 20) return;

    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxEntries) return;

      const fullPath = path.join(dir, entry.name);

      // Skip heavy/system dirs
      if (entry.isDirectory() && (entry.name === "node_modules" || entry.name === ".git")) continue;

      const matches = !pattern || FsTools.matchPattern(entry.name, pattern);
      if (matches) {
        let size = 0;
        try {
          size = entry.isFile() ? (await fsp.stat(fullPath)).size : 0;
        } catch {}
        results.push({
          path: fullPath,
          type: entry.isDirectory() ? "directory" : "file",
          size,
        });
      }

      if (entry.isDirectory()) {
        await FsTools.walkDirAsync(fullPath, pattern, maxEntries, results, level + 1);
      }
    }
  }

  // ── Tool Implementations ──────────────────────────────────────

  private static async fsReadFile(args: Record<string, unknown>): Promise<unknown> {
    const filePath = FsTools.resolvePath(args.filePath as string);
    const encoding = (args.encoding as BufferEncoding) || "utf-8";

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`);
    }

    const startLine = (args.startLine as number) || undefined;
    const endLine = (args.endLine as number) || undefined;
    const byteOffset = typeof args.offset === "number" ? args.offset : undefined;
    const byteLength = typeof args.length === "number" ? args.length : undefined;
    const isPartialRead = !!(startLine || endLine || byteOffset !== undefined);

    // Byte-level chunked reading — works on any file size
    if (byteOffset !== undefined) {
      const maxChunk = 1024 * 1024; // 1 MB max per chunk
      const readLen = Math.min(byteLength || FS_DEFAULT_CHUNK_BYTES, maxChunk);
      const start = Math.max(0, byteOffset);
      const end = Math.min(stat.size - 1, start + readLen - 1);
      if (start >= stat.size) {
        return { filePath, size: stat.size, offset: start, content: "", note: "Offset beyond end of file." };
      }
      const buf = Buffer.alloc(end - start + 1);
      const fh = await fsp.open(filePath, "r");
      try {
        await fh.read(buf, 0, buf.length, start);
      } finally {
        await fh.close();
      }
      const content = encoding === "base64" ? buf.toString("base64") : buf.toString(encoding);
      return {
        filePath,
        size: stat.size,
        offset: start,
        bytesRead: buf.length,
        hasMore: end < stat.size - 1,
        content,
      };
    }

    // Full-file read — enforce size limit unless line-range params are provided
    if (stat.size > FS_MAX_READ_BYTES && encoding !== "base64" && !isPartialRead) {
      throw new Error(
        `File is too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Max for full reads is ${FS_MAX_READ_BYTES / 1024 / 1024} MB. Use startLine/endLine for line-based chunking or offset/length for byte-based chunking.`
      );
    }

    let content: string;
    if (encoding === "base64") {
      content = (await fsp.readFile(filePath)).toString("base64");
    } else {
      content = await fsp.readFile(filePath, encoding);
    }

    // Line range slicing
    if (startLine || endLine) {
      const lines = content.split("\n");
      const s = Math.max(0, (startLine || 1) - 1);
      const e = Math.min(lines.length, endLine || lines.length);
      content = lines.slice(s, e).join("\n");
    }

    return {
      filePath,
      size: stat.size,
      lineCount: content.split("\n").length,
      content,
    };
  }

  private static decodeHtmlEntities(input: string): string {
    return input
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&#x2F;/gi, "/");
  }

  private static extractReadableText(raw: string): string {
    return FsTools.decodeHtmlEntities(
      raw
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  private static async fsExtractText(args: Record<string, unknown>): Promise<unknown> {
    const filePath = FsTools.resolvePath(args.filePath as string);
    const encoding = (args.encoding as BufferEncoding) || "utf-8";
    const byteOffset = typeof args.offset === "number" ? Math.max(0, args.offset) : 0;
    const requestedLen = typeof args.length === "number" ? args.length : FS_EXTRACT_DEFAULT_BYTES;
    const readLen = Math.min(Math.max(1, requestedLen), 1024 * 1024);
    const maxChars = Math.min(Math.max(1, (args.maxChars as number) || FS_EXTRACT_DEFAULT_MAX_CHARS), FS_EXTRACT_MAX_CHARS_LIMIT);

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`);
    }

    // Require chunking for very large files to avoid huge memory spikes.
    if (stat.size > FS_MAX_READ_BYTES && args.offset === undefined && args.length === undefined) {
      throw new Error(
        `File is too large (${(stat.size / 1024 / 1024).toFixed(1)} MB) for default extraction. Provide offset/length to process it in chunks.`
      );
    }

    if (byteOffset >= stat.size) {
      return {
        filePath,
        size: stat.size,
        offset: byteOffset,
        bytesRead: 0,
        hasMore: false,
        extractedChars: 0,
        text: "",
      };
    }

    // Fast-path: DOCX files — extract text from word/document.xml inside the ZIP
    if (filePath.toLowerCase().endsWith(".docx")) {
      const zipBuf = await fsp.readFile(filePath);
      const zip = await JSZip.loadAsync(zipBuf);
      const docXml = zip.file("word/document.xml");
      if (docXml) {
        const xml = await docXml.async("text");
        // Strip XML tags, decode entities, collapse whitespace
        const textRaw = xml
          .replace(/<w:br[^/]*/g, "\n")   // line breaks
          .replace(/<\/w:p>/g, "\n")       // paragraph ends → newline
          .replace(/<[^>]+>/g, "")         // all other tags
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/[ \t]+/g, " ")
          .trim();
        const text = textRaw.length > maxChars ? textRaw.slice(0, maxChars) : textRaw;
        return {
          filePath,
          size: stat.size,
          offset: 0,
          bytesRead: stat.size,
          hasMore: false,
          extractedChars: textRaw.length,
          text,
        };
      }
    }

    const end = Math.min(stat.size - 1, byteOffset + readLen - 1);
    const buf = Buffer.alloc(end - byteOffset + 1);
    const fh = await fsp.open(filePath, "r");
    try {
      await fh.read(buf, 0, buf.length, byteOffset);
    } finally {
      await fh.close();
    }

    const raw = buf.toString(encoding);
    const extracted = FsTools.extractReadableText(raw);
    const text = extracted.length > maxChars ? extracted.slice(0, maxChars) : extracted;

    return {
      filePath,
      size: stat.size,
      offset: byteOffset,
      bytesRead: buf.length,
      hasMore: end < stat.size - 1,
      extractedChars: extracted.length,
      text,
    };
  }

  private static async fsReadDirectory(args: Record<string, unknown>): Promise<unknown> {
    const dirPath = FsTools.resolvePath(args.dirPath as string);
    const recursive = (args.recursive as boolean) || false;
    const pattern = args.pattern as string | undefined;

    let dirStat: fs.Stats;
    try {
      dirStat = await fsp.stat(dirPath);
    } catch {
      throw new Error(`Directory not found: ${dirPath}`);
    }
    if (!dirStat.isDirectory()) {
      throw new Error(`Path is not a directory: ${dirPath}`);
    }

    if (recursive) {
      const results: Array<{ path: string; type: "file" | "directory"; size: number }> = [];
      await FsTools.walkDirAsync(dirPath, pattern, FS_WALK_DIR_LIMIT, results);
      return { dirPath, entryCount: results.length, entries: results };
    }

    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter((e) => !pattern || FsTools.matchPattern(e.name, pattern))
        .map(async (e) => {
          const fp = path.join(dirPath, e.name);
          let size = 0;
          try {
            size = e.isFile() ? (await fsp.stat(fp)).size : 0;
          } catch {}
          return {
            name: e.name,
            type: e.isDirectory() ? "directory" : "file",
            size,
          };
        })
    );

    return { dirPath, entryCount: items.length, entries: items };
  }

  private static async fsFileInfo(args: Record<string, unknown>): Promise<unknown> {
    const targetPath = FsTools.resolvePath(args.targetPath as string);

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(targetPath);
    } catch {
      throw new Error(`Path not found: ${targetPath}`);
    }
    return {
      path: targetPath,
      type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
      size: stat.size,
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      accessedAt: stat.atime.toISOString(),
      permissions: `0${(stat.mode & 0o777).toString(8)}`,
      isSymbolicLink: stat.isSymbolicLink(),
    };
  }

  private static async fsSearchFiles(args: Record<string, unknown>): Promise<unknown> {
    const dirPath = FsTools.resolvePath(args.dirPath as string);
    const pattern = args.pattern as string;
    const maxResults = Math.min((args.maxResults as number) || 50, 200);

    try {
      await fsp.access(dirPath);
    } catch {
      throw new Error(`Directory not found: ${dirPath}`);
    }

    const results: Array<{ path: string; type: "file" | "directory"; size: number }> = [];
    await FsTools.walkDirAsync(dirPath, pattern, maxResults, results);

    return {
      dirPath,
      pattern,
      matchCount: results.length,
      matches: results,
    };
  }

  private static async fsCreateFile(args: Record<string, unknown>): Promise<unknown> {
    const filePath = FsTools.resolvePath(args.filePath as string);
    const content = args.content as string;
    const encoding = (args.encoding as BufferEncoding) || "utf-8";

    try {
      await fsp.access(filePath);
      throw new Error(
        `File already exists: ${filePath}. Use fs_update_file to modify an existing file.`
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    // Ensure parent directories exist
    const dir = path.dirname(filePath);
    await fsp.mkdir(dir, { recursive: true });

    if (encoding === "base64") {
      await fsp.writeFile(filePath, Buffer.from(content, "base64"));
    } else {
      await fsp.writeFile(filePath, content, encoding);
    }

    const stat = await fsp.stat(filePath);
    return {
      filePath,
      size: stat.size,
      created: true,
    };
  }

  private static async fsUpdateFile(args: Record<string, unknown>): Promise<unknown> {
    const filePath = FsTools.resolvePath(args.filePath as string);

    let fileStat: fs.Stats;
    try {
      fileStat = await fsp.stat(filePath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }
    if (!fileStat.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`);
    }

    // Mode 1: Search & Replace
    if (args.search !== undefined) {
      const search = args.search as string;
      const replace = args.replace as string ?? "";
      const existing = await fsp.readFile(filePath, "utf-8");

      if (!existing.includes(search)) {
        throw new Error(`Search string not found in file: ${filePath}`);
      }

      const updated = existing.replace(search, replace);
      await fsp.writeFile(filePath, updated, "utf-8");

      return {
        filePath,
        mode: "search-replace",
        replacements: 1,
        newSize: Buffer.byteLength(updated, "utf-8"),
      };
    }

    // Mode 2: Append
    if (args.appendContent !== undefined) {
      const appendContent = args.appendContent as string;
      await fsp.appendFile(filePath, appendContent, "utf-8");
      const stat = await fsp.stat(filePath);
      return {
        filePath,
        mode: "append",
        newSize: stat.size,
      };
    }

    // Mode 3: Full overwrite
    if (args.content !== undefined) {
      const content = args.content as string;
      await fsp.writeFile(filePath, content, "utf-8");
      return {
        filePath,
        mode: "overwrite",
        newSize: Buffer.byteLength(content, "utf-8"),
      };
    }

    throw new Error("Provide one of: content (full overwrite), search+replace, or appendContent.");
  }

  private static async fsDeleteFile(args: Record<string, unknown>): Promise<unknown> {
    const filePath = FsTools.resolvePath(args.filePath as string);

    let fileStat: fs.Stats;
    try {
      fileStat = await fsp.stat(filePath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }
    if (!fileStat.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`);
    }

    const size = fileStat.size;
    await fsp.unlink(filePath);

    return {
      filePath,
      deleted: true,
      previousSize: size,
    };
  }

  private static async fsDeleteDirectory(args: Record<string, unknown>): Promise<unknown> {
    const dirPath = FsTools.resolvePath(args.dirPath as string);

    let dirStat: fs.Stats;
    try {
      dirStat = await fsp.stat(dirPath);
    } catch {
      throw new Error(`Directory not found: ${dirPath}`);
    }
    if (!dirStat.isDirectory()) {
      throw new Error(`Path is not a directory: ${dirPath}`);
    }

    // Count contents before deletion (walkDir is bounded / sync — acceptable for pre-delete audit)
    const results: Array<{ path: string; type: "file" | "directory"; size: number }> = [];
    await FsTools.walkDirAsync(dirPath, undefined, 1000, results);

    await fsp.rm(dirPath, { recursive: true, force: true });

    return {
      dirPath,
      deleted: true,
      entriesRemoved: results.length,
    };
  }

  private static async fsExecuteScript(args: Record<string, unknown>): Promise<unknown> {
    const command = args.command as string;
    const cwd = args.cwd ? FsTools.resolvePath(args.cwd as string) : process.cwd();
    const timeout = Math.min((args.timeout as number) || FS_SCRIPT_TIMEOUT_MS, 120_000);

    if (!command || typeof command !== "string" || command.trim().length === 0) {
      throw new Error("Command must be a non-empty string.");
    }

    // Block known dangerous patterns (despite HITL approval, defence-in-depth)
    const BLOCKED_PATTERNS = [
      /\brm\s+(-rf?\s+)?\//i,          // rm -rf /
      /\bdd\b.*\bof=\/dev\//i,          // dd to devices
      /\b(mkfs|fdisk|wipefs)\b/i,       // disk formatting
      /\bcurl\b.*\|.*\b(sh|bash)\b/i,  // curl | sh
      /\bwget\b.*\|.*\b(sh|bash)\b/i,  // wget | sh
    ];
    for (const pat of BLOCKED_PATTERNS) {
      if (pat.test(command)) {
        throw new Error(`Blocked: command matches a dangerous pattern and cannot be executed.`);
      }
    }

    if (cwd) {
      try {
        await fsp.access(cwd);
      } catch {
        throw new Error(`Working directory not found: ${cwd}`);
      }
    }

    // Explicit shell — this is an intentional HITL-approved script runner.
    // The shell binary is hardcoded to prevent PATH-based injection.
    const shellBin = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: FS_MAX_SCRIPT_OUTPUT,
        shell: shellBin,
      });

      return {
        command,
        cwd,
        exitCode: 0,
        stdout: stdout.slice(0, FS_MAX_SCRIPT_OUTPUT),
        stderr: stderr.slice(0, FS_MAX_SCRIPT_OUTPUT),
      };
    } catch (err: any) {
      return {
        command,
        cwd,
        exitCode: err.code ?? 1,
        stdout: (err.stdout || "").slice(0, FS_MAX_SCRIPT_OUTPUT),
        stderr: (err.stderr || err.message || "").slice(0, FS_MAX_SCRIPT_OUTPUT),
        error: err.killed ? "Process timed out" : undefined,
      };
    }
  }
}

export const fsTools = new FsTools();
registerToolCategory(fsTools);

// ── Public API ────────────────────────────────────────────────

/**
 * Check whether a tool name is a built-in filesystem tool.
 */
export const isFsTool = FsTools.isTool.bind(FsTools);

/**
 * Execute a built-in filesystem tool and return the result.
 */
export const executeBuiltinFsTool = FsTools.executeBuiltin.bind(FsTools);
