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
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("agent.worker-manager");

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

/* ── Worker Pool ────────────────────────────────────────────────────── */

interface PooledWorker {
  worker: Worker;
  busy: boolean;
  task: TaskBinding | null;
}

interface TaskBinding {
  settled: boolean;
  resolve: (result: WorkerDoneResult) => void;
  reject: (error: Error) => void;
  onToken?: OnTokenFn;
  onStatus?: OnStatusFn;
  onToolRequest?: OnToolRequestFn;
  timeout: ReturnType<typeof setTimeout>;
  handle: TaskHandle;
}

interface QueuedTask {
  config: WorkerStartConfig;
  onToken?: OnTokenFn;
  onStatus?: OnStatusFn;
  onToolRequest?: OnToolRequestFn;
  resolve: (result: WorkerDoneResult) => void;
  reject: (error: Error) => void;
  handle: TaskHandle;
  queueTimer: ReturnType<typeof setTimeout>;
}

interface TaskHandle {
  state: "queued" | "dispatched" | "settled";
  pw: PooledWorker | null;
}

const POOL_SIZE = Math.min(
  Math.max(env.WORKER_POOL_SIZE, 1),
  8
);

const pool: PooledWorker[] = [];
const taskQueue: QueuedTask[] = [];
let poolInitialized = false;

function ensurePool(): void {
  if (poolInitialized) return;
  poolInitialized = true;
  for (let i = 0; i < POOL_SIZE; i++) {
    try {
      pool.push(spawnPooledWorker());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog({
        level: "error",
        source: "worker-pool",
        message: `Failed to create pool worker ${i}: ${msg}`,
        metadata: null,
      });
      log.error(`Failed to create pool worker ${i}`, { workerIndex: i }, err);
    }
  }
  if (pool.length > 0) {
    addLog({
      level: "info",
      source: "worker-pool",
      message: `Worker pool initialized with ${pool.length} thread(s)`,
      metadata: null,
    });
    log.info(`Worker pool initialized with ${pool.length} thread(s)`, { poolSize: pool.length });
  }
}

function spawnPooledWorker(): PooledWorker {
  const worker = new Worker(WORKER_SCRIPT);
  const pw: PooledWorker = { worker, busy: false, task: null };

  worker.on("message", async (msg: {
    type: string;
    data?: unknown;
    requestId?: string;
    calls?: ToolCall[];
    assistantContent?: string | null;
  }) => {
    await handlePoolMessage(pw, msg);
  });

  worker.on("error", (err: Error) => handlePoolError(pw, err));
  worker.on("exit", (code: number) => handlePoolExit(pw, code));

  return pw;
}

async function handlePoolMessage(pw: PooledWorker, msg: {
  type: string;
  data?: unknown;
  requestId?: string;
  calls?: ToolCall[];
  assistantContent?: string | null;
}) {
  const task = pw.task;
  if (!task || task.settled) return;

  try {
    switch (msg.type) {
      case "token":
        await task.onToken?.(msg.data as string);
        break;

      case "status":
        task.onStatus?.(msg.data as { step: string; detail?: string });
        break;

      case "tool_request": {
        if (!task.onToolRequest) {
          pw.worker.postMessage({
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
        const results = await task.onToolRequest(
          msg.calls || [],
          msg.assistantContent ?? null
        );
        pw.worker.postMessage({
          type: "tool_result",
          requestId: msg.requestId,
          results,
        });
        break;
      }

      case "done":
        settleTask(pw, () => task.resolve(msg.data as WorkerDoneResult));
        break;

      case "error":
        settleTask(pw, () => task.reject(new Error(msg.data as string)));
        break;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    settleTask(pw, () =>
      task.reject(new Error(`Worker message handler error: ${errMsg}`))
    );
  }
}

function handlePoolError(pw: PooledWorker, err: Error) {
  if (pw.task && !pw.task.settled) {
    const reject = pw.task.reject;
    settleTask(pw, () => reject(err), true);
  }
  replaceWorker(pw);
}

function handlePoolExit(pw: PooledWorker, code: number) {
  if (pw.task && !pw.task.settled) {
    const reject = pw.task.reject;
    settleTask(
      pw,
      () =>
        reject(
          new Error(
            code !== 0
              ? `Agent worker exited with code ${code}`
              : "Agent worker exited before completing"
          )
        ),
      true
    );
  }
  replaceWorker(pw);
}

function settleTask(pw: PooledWorker, fn: () => void, skipRelease = false) {
  const task = pw.task;
  if (!task || task.settled) return;
  task.settled = true;
  task.handle.state = "settled";
  clearTimeout(task.timeout);
  pw.task = null;
  pw.busy = false;
  fn();
  if (!skipRelease) drainQueue();
}

function replaceWorker(pw: PooledWorker) {
  const idx = pool.indexOf(pw);
  if (idx === -1) return;
  try {
    pw.worker.terminate();
  } catch {
    /* already exited */
  }
  try {
    pool[idx] = spawnPooledWorker();
    addLog({
      level: "warn",
      source: "worker-pool",
      message: "Worker crashed and was replaced",
      metadata: null,
    });
    log.warning("Worker crashed and was replaced", { poolIdx: idx });
  } catch (err) {
    pool.splice(idx, 1);
    const msg = err instanceof Error ? err.message : String(err);
    addLog({
      level: "error",
      source: "worker-pool",
      message: `Failed to replace worker: ${msg}`,
      metadata: null,
    });
    log.error("Failed to replace worker", { poolIdx: idx }, err);
  }
  drainQueue();
}

function drainQueue() {
  while (taskQueue.length > 0) {
    const idle = pool.find((w) => !w.busy);
    if (!idle) break;
    const queued = taskQueue.shift()!;
    clearTimeout(queued.queueTimer);
    if (queued.handle.state === "settled") continue;
    assignTask(
      idle,
      queued.config,
      queued.onToken,
      queued.onStatus,
      queued.onToolRequest,
      queued.resolve,
      queued.reject,
      queued.handle
    );
  }
}

function assignTask(
  pw: PooledWorker,
  config: WorkerStartConfig,
  onToken: OnTokenFn | undefined,
  onStatus: OnStatusFn | undefined,
  onToolRequest: OnToolRequestFn | undefined,
  resolve: (r: WorkerDoneResult) => void,
  reject: (e: Error) => void,
  handle: TaskHandle
) {
  pw.busy = true;
  handle.state = "dispatched";
  handle.pw = pw;

  const timeout = setTimeout(() => {
    settleTask(pw, () => reject(new Error("Agent worker timed out after 30s")), true);
    replaceWorker(pw);
  }, 30_000);

  pw.task = {
    settled: false,
    resolve,
    reject,
    onToken,
    onStatus,
    onToolRequest,
    timeout,
    handle,
  };

  pw.worker.postMessage({
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
}

/* ── Run a single LLM session via the worker pool ──────────────────── */

/**
 * Run an LLM session using a pooled worker thread.
 *
 * Workers are reused across requests (pool size controlled by
 * WORKER_POOL_SIZE env var, default 2, max 8).  If all workers are busy,
 * the task is queued and dispatched when one becomes idle.
 */
export function runLlmInWorker(
  config: WorkerStartConfig,
  onToken?: OnTokenFn,
  onStatus?: OnStatusFn,
  onToolRequest?: OnToolRequestFn
): { promise: Promise<WorkerDoneResult>; abort: () => void } {
  log.enter("runLlmInWorker", { maxIterations: config.maxIterations, toolCount: config.tools.length });
  ensurePool();

  const handle: TaskHandle = { state: "queued", pw: null };
  let queuedEntry: QueuedTask | null = null;

  const promise = new Promise<WorkerDoneResult>((resolve, reject) => {
    const idle = pool.find((w) => !w.busy);
    if (idle) {
      assignTask(idle, config, onToken, onStatus, onToolRequest, resolve, reject, handle);
    } else {
      const queueTimer = setTimeout(() => {
        const idx = taskQueue.indexOf(queuedEntry!);
        if (idx !== -1) taskQueue.splice(idx, 1);
        if (handle.state !== "settled") {
          handle.state = "settled";
          reject(new Error("Worker pool queue timeout — all workers busy for 30s"));
        }
      }, 30_000);

      queuedEntry = {
        config,
        onToken,
        onStatus,
        onToolRequest,
        resolve,
        reject,
        handle,
        queueTimer,
      };
      taskQueue.push(queuedEntry);
    }
  });

  const abort = () => {
    if (handle.state === "settled") return;

    if (handle.state === "queued" && queuedEntry) {
      const idx = taskQueue.indexOf(queuedEntry);
      if (idx !== -1) taskQueue.splice(idx, 1);
      clearTimeout(queuedEntry.queueTimer);
      handle.state = "settled";
      queuedEntry.reject(new Error("Aborted while queued"));
    } else if (handle.state === "dispatched" && handle.pw) {
      const pw = handle.pw;
      pw.worker.postMessage({ type: "abort" });
      setTimeout(() => {
        if (pw.task && !pw.task.settled) {
          settleTask(pw, () => pw.task!.reject(new Error("Aborted")), true);
          replaceWorker(pw);
        }
      }, 1000);
    }
  };

  return { promise, abort };
}

/* ── Pool diagnostics ──────────────────────────────────────────────── */

export function getWorkerPoolStats() {
  return {
    poolSize: POOL_SIZE,
    initialized: poolInitialized,
    busyCount: pool.filter((w) => w.busy).length,
    idleCount: pool.filter((w) => !w.busy).length,
    queueLength: taskQueue.length,
  };
}

/** @internal — reset pool state for testing */
export function _resetPool() {
  for (const pw of pool) {
    if (pw.task) {
      clearTimeout(pw.task.timeout);
      pw.task = null;
    }
    try { pw.worker.terminate(); } catch { /* ignore */ }
  }
  for (const qt of taskQueue) {
    clearTimeout(qt.queueTimer);
  }
  pool.length = 0;
  taskQueue.length = 0;
  poolInitialized = false;
}
