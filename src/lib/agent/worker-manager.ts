/**
 * Agent Worker Manager
 *
 * Manages a worker thread that runs LLM communication off the main thread.
 * The main thread retains all DB operations, tool execution, knowledge
 * retrieval, and SSE streaming — the worker ONLY handles LLM API calls
 * and token streaming.
 *
 * If the worker fails to spawn (e.g. missing native addons in the thread),
 * the caller should fall back to the main-thread `runAgentLoop()`.
 */

import { Worker } from "worker_threads";
import path from "path";
import type { ChatMessage, ToolDefinition, ToolCall } from "@/lib/llm";
import { addLog } from "@/lib/db";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface WorkerProviderConfig {
  providerType: string;
  apiKey: string;
  model?: string;
  endpoint?: string;
  deployment?: string;
  apiVersion?: string;
  baseURL?: string;
  disableThinking?: boolean;
}

export interface WorkerStartConfig {
  provider: WorkerProviderConfig;
  systemPrompt: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxIterations?: number;
}

export interface WorkerToolResult {
  toolCallId: string;
  toolName: string;
  content: string;
}

export interface WorkerDoneResult {
  content: string;
  toolsUsed: string[];
  iterations: number;
}

export type OnTokenFn = (token: string) => void | Promise<void>;
export type OnStatusFn = (status: { step: string; detail?: string }) => void;
export type OnToolRequestFn = (
  calls: ToolCall[],
  assistantContent: string | null
) => Promise<WorkerToolResult[]>;

/* ── Worker path ───────────────────────────────────────────────────── */

const WORKER_SCRIPT = path.join(process.cwd(), "scripts", "agent-worker.js");

/* ── Check if worker is available ──────────────────────────────────── */

let _workerAvailable: boolean | null = null;

export function isWorkerAvailable(): boolean {
  if (_workerAvailable !== null) return _workerAvailable;
  try {
    const fs = require("fs");
    _workerAvailable = fs.existsSync(WORKER_SCRIPT) as boolean;
  } catch {
    _workerAvailable = false;
  }
  return _workerAvailable!;
}

/* ── Run a single LLM session in a worker thread ───────────────────── */

/**
 * Spawn a worker thread to handle LLM communication.
 *
 * Returns a Promise that resolves with the final response, or rejects
 * on error.  The worker is transient — created per request and terminated
 * after the response is complete.
 *
 * @param config       Provider + prompt + messages + tools
 * @param onToken      Called for each streamed LLM token
 * @param onStatus     Called for status updates (model selection, iterations)
 * @param onToolRequest Called when the LLM wants to execute tools.
 *                      The callback must execute them (in the main thread)
 *                      and return the results.
 */
export function runLlmInWorker(
  config: WorkerStartConfig,
  onToken?: OnTokenFn,
  onStatus?: OnStatusFn,
  onToolRequest?: OnToolRequestFn
): { promise: Promise<WorkerDoneResult>; abort: () => void } {
  let worker: Worker | null = null;
  let settled = false;

  const promise = new Promise<WorkerDoneResult>((resolve, reject) => {
    try {
      worker = new Worker(WORKER_SCRIPT);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog({
        level: "error",
        source: "worker",
        message: `Failed to spawn agent worker: ${msg}`,
        metadata: null,
      });
      reject(new Error(`Worker spawn failed: ${msg}`));
      return;
    }

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    // Hard timeout: 30 seconds — if the worker hasn't responded by then,
    // kill it and fall back to main thread (which has its own fallback logic)
    const timeout = setTimeout(() => {
      settle(() => {
        worker?.terminate();
        reject(new Error("Agent worker timed out after 30s"));
      });
    }, 30_000);

    worker.on("message", async (msg: {
      type: string;
      data?: unknown;
      requestId?: string;
      calls?: ToolCall[];
      assistantContent?: string | null;
    }) => {
      try {
        switch (msg.type) {
          case "token":
            await onToken?.(msg.data as string);
            break;

          case "status":
            onStatus?.(msg.data as { step: string; detail?: string });
            break;

          case "tool_request": {
            if (!onToolRequest) {
              // No tool handler — send empty results
              worker?.postMessage({
                type: "tool_result",
                requestId: msg.requestId,
                results: (msg.calls || []).map((tc: ToolCall) => ({
                  toolCallId: tc.id,
                  toolName: tc.name,
                  content: JSON.stringify({ error: "Tool execution not available" }),
                })),
              });
              break;
            }
            const results = await onToolRequest(
              msg.calls || [],
              msg.assistantContent ?? null
            );
            worker?.postMessage({
              type: "tool_result",
              requestId: msg.requestId,
              results,
            });
            break;
          }

          case "done":
            clearTimeout(timeout);
            settle(() => {
              worker?.terminate();
              resolve(msg.data as WorkerDoneResult);
            });
            break;

          case "error":
            clearTimeout(timeout);
            settle(() => {
              worker?.terminate();
              reject(new Error(msg.data as string));
            });
            break;
        }
      } catch (err) {
        clearTimeout(timeout);
        const errMsg = err instanceof Error ? err.message : String(err);
        settle(() => {
          worker?.terminate();
          reject(new Error(`Worker message handler error: ${errMsg}`));
        });
      }
    });

    worker.on("error", (err) => {
      clearTimeout(timeout);
      settle(() => {
        worker?.terminate();
        reject(err);
      });
    });

    worker.on("exit", (code) => {
      clearTimeout(timeout);
      settle(() => {
        if (code !== 0) {
          reject(new Error(`Agent worker exited with code ${code}`));
        } else {
          reject(new Error("Agent worker exited before completing"));
        }
      });
    });

    // Send the start command
    worker.postMessage({
      type: "start",
      config: {
        providerType: config.provider.providerType,
        apiKey: config.provider.apiKey,
        model: config.provider.model,
        endpoint: config.provider.endpoint,
        deployment: config.provider.deployment,
        apiVersion: config.provider.apiVersion,
        baseURL: config.provider.baseURL,
        disableThinking: config.provider.disableThinking,
        systemPrompt: config.systemPrompt,
        messages: config.messages,
        tools: config.tools,
        maxIterations: config.maxIterations || 25,
      },
    });
  });

  const abort = () => {
    if (worker && !settled) {
      worker.postMessage({ type: "abort" });
      // Give the worker 1s to clean up, then force terminate
      setTimeout(() => {
        if (!settled) {
          worker?.terminate();
        }
      }, 1000);
    }
  };

  return { promise, abort };
}
