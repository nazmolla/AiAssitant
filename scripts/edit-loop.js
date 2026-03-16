/**
 * One-shot script to transform loop.ts for issue #111.
 * Removes extracted code and replaces inline logic with module calls.
 * Run with: node scripts/edit-loop.js
 */
const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "src", "lib", "agent", "loop.ts");
const content = fs.readFileSync(filePath, "utf-8");
const lines = content.split(/\r?\n/);

console.log("Original lines:", lines.length);

// === Step 1: New imports block ===
const newImports = `/**
 * Nexus Agent Core Loop
 *
 * Implements the Sense-Think-Act loop:
 * 1. Receives user message
 * 2. Builds context (knowledge, thread history)
 * 3. Calls LLM with available MCP tools
 * 4. Processes tool calls through HITL gatekeeper
 * 5. Iterates until LLM produces a final response
 */

import {
  selectProvider,
  selectFallbackProvider,
  type ChatMessage,
  type ChatResponse,
  type ToolCall,
  type ContentPart,
} from "@/lib/llm";
import { getMcpManager } from "@/lib/mcp";
import { BUILTIN_WEB_TOOLS } from "./web-tools";
import { BUILTIN_BROWSER_TOOLS } from "./browser-tools";
import { BUILTIN_FS_TOOLS } from "./fs-tools";
import { BUILTIN_NETWORK_TOOLS } from "./network-tools";
import { BUILTIN_EMAIL_TOOLS } from "./email-tools";
import { BUILTIN_FILE_TOOLS } from "./file-tools";
import { BUILTIN_ALEXA_TOOLS } from "./alexa-tools";
import { getToolRegistry } from "./tool-registry";
import {
  addMessage,
  getThreadMessages,
  getThread,
  addLog,
  addAttachment,
  getUserById,
  listToolPolicies,
  upsertSchedulerScheduleByKey,
  updateSchedulerTaskGraph,
  getDb,
  type Message,
  type AttachmentMeta,
} from "@/lib/db";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { parseScheduledTasksFromUserMessage } from "@/lib/scheduler/task-parser";
import { buildCappedToolList } from "./tool-cap";
import { SYSTEM_PROMPT, MAX_TOOL_ITERATIONS, isUntrustedToolOutput } from "./system-prompt";
import { isAffirmativeApproval, isNegativeApproval, extractLatestInlineApproval } from "./approval-handler";
import { buildKnowledgeContext, buildProfileContext } from "./context-builder";
import { dbMessagesToChat } from "./message-converter";
import { executeToolWithPolicy } from "./tool-executor";
import { maybeUpdateThreadTitle } from "./title-generator";
import { persistKnowledgeFromTurn } from "./knowledge-persistence";`;

// === Step 2: Knowledge/profile replacement block ===
const newKnowledgeBlock = `  const knowledgeSnippets: string[] = [\`[User]\\n\${queryText}\`];

  // Build context from knowledge vault and user profile (extracted to context-builder.ts)
  const knowledgeContext = await buildKnowledgeContext(queryText, userId, onStatus);
  onStatus?.({ step: "Building context", detail: "Loading user profile and chat history" });
  const profileContext = buildProfileContext(userId);`;

// === Step 3: Re-exports for backward compatibility ===
const reExports = `
// Re-export for backward compatibility (loop-worker.ts, tests import from "./loop")
export { SYSTEM_PROMPT } from "./system-prompt";
export { dbMessagesToChat } from "./message-converter";
export { maybeUpdateThreadTitle } from "./title-generator";
export { persistKnowledgeFromTurn } from "./knowledge-persistence";
`;

// === Apply transformations ===
// Line numbers are 1-indexed from the original file

// Regions to KEEP (1-indexed, inclusive):
//   yieldLoop helper: line 57-58
//   AgentResponse interface: line 207-212
//   runAgentLoop function: line 213 through end of continueAgentLoop (line 883)
//   BUT within runAgentLoop, lines 468-530 (knowledge/profile) need replacement

// Strategy: build new file from kept sections

const result = [];

// Part 1: New imports + yieldLoop
result.push(newImports);
result.push("");
// Lines 57-58 (yieldLoop) from original
result.push(lines[56]); // "/** Yield the event loop..." 
result.push(lines[57]); // "const yieldLoop = ..."
result.push("");

// Part 2: AgentResponse interface (lines 207-212)
for (let i = 206; i <= 211; i++) {
  result.push(lines[i]);
}
result.push("");

// Part 3: runAgentLoop function up to knowledge block (lines 213-467)
for (let i = 212; i <= 466; i++) {
  result.push(lines[i]);
}

// Part 4: Replacement knowledge/profile block
result.push(newKnowledgeBlock);

// Part 5: Rest of runAgentLoop after profile context block (lines 527-883)
// Find where the profile context block ends (after "const chatMessages = dbMessagesToChat...")
// Line 527 starts with "  // Build message history"
for (let i = 526; i <= 882; i++) {
  result.push(lines[i]);
}

// Part 6: Re-exports
result.push(reExports);

const output = result.join("\r\n");

fs.writeFileSync(filePath, output);
console.log("New lines:", output.split(/\r?\n/).length);
console.log("loop.ts successfully transformed!");
