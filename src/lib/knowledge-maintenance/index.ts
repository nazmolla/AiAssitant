import { Worker } from "worker_threads";
import path from "path";
import { addLog } from "@/lib/db";

declare global {
  var __nexus_knowledgeWorkerStarted: boolean | undefined;
  var __nexus_knowledgeWorker: Worker | undefined;
}

export function startKnowledgeMaintenanceWorker(): void {
  if (globalThis.__nexus_knowledgeWorkerStarted) return;

  const scriptPath = path.join(process.cwd(), "scripts", "knowledge-maintenance-worker.js");
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "nexus.db");

  try {
    const worker = new Worker(scriptPath, {
      workerData: {
        dbPath,
      },
    });

    worker.on("message", (msg: { type?: string; message?: string; metadata?: unknown; level?: string }) => {
      if (!msg || msg.type !== "log") return;
      addLog({
        level: msg.level || "info",
        source: "knowledge-maintenance",
        message: msg.message || "Knowledge maintenance worker event.",
        metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
      });
    });

    worker.on("error", (err) => {
      addLog({
        level: "error",
        source: "knowledge-maintenance",
        message: `Knowledge maintenance worker error: ${err.message}`,
        metadata: JSON.stringify({ stack: err.stack }),
      });
    });

    worker.on("exit", (code) => {
      addLog({
        level: code === 0 ? "info" : "error",
        source: "knowledge-maintenance",
        message: `Knowledge maintenance worker exited with code ${code}.`,
        metadata: JSON.stringify({ code }),
      });
      globalThis.__nexus_knowledgeWorkerStarted = false;
      globalThis.__nexus_knowledgeWorker = undefined;
    });

    globalThis.__nexus_knowledgeWorker = worker;
    globalThis.__nexus_knowledgeWorkerStarted = true;

    addLog({
      level: "info",
      source: "knowledge-maintenance",
      message: "Knowledge maintenance worker started.",
      metadata: JSON.stringify({ dbPath }),
    });
  } catch (err) {
    addLog({
      level: "error",
      source: "knowledge-maintenance",
      message: "Failed to start knowledge maintenance worker.",
      metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    });
  }
}
