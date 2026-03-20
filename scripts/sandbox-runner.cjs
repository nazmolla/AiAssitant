/**
 * sandbox-runner.cjs
 *
 * Isolated child-process sandbox for custom tool execution.
 * Spawned by CustomToolRuntime.runSandboxed() with an empty environment
 * so parent process secrets (DB path, NEXTAUTH_SECRET, API keys) are NOT
 * inherited.  Receives { code, args } as JSON on stdin, writes
 * { result } or { error } to stdout, then exits.
 *
 * Using a child process instead of node:vm prevents constructor-chain
 * prototype escapes from reaching parent in-memory state.
 */

"use strict";

const { createContext, Script } = require("vm");

let raw = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stdout.write(JSON.stringify({ error: "Invalid input: could not parse JSON" }));
    process.exit(1);
  }

  const { code, args } = parsed;
  if (typeof code !== "string") {
    process.stdout.write(JSON.stringify({ error: "Invalid input: code must be a string" }));
    process.exit(1);
  }

  const logLines = [];
  const sandbox = {
    JSON,
    Math,
    Date,
    RegExp,
    URL,
    URLSearchParams,
    Buffer,
    console: {
      log:   (...a) => logLines.push({ level: "verbose", msg: a.join(" ") }),
      warn:  (...a) => logLines.push({ level: "warning", msg: a.join(" ") }),
      error: (...a) => logLines.push({ level: "error",   msg: a.join(" ") }),
    },
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    __args__: args ?? {},
    __result__: undefined,
  };

  createContext(sandbox);

  const wrappedCode = `
(async () => {
  const args = __args__;
  ${code}
})().then(r => { __result__ = { ok: r }; }).catch(e => { __result__ = { err: e.message || String(e) }; });
`;

  try {
    const script = new Script(wrappedCode, { filename: "custom-tool.js" });
    script.runInContext(sandbox, { timeout: 5000 });
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: err.message || String(err), logs: logLines }));
    process.exit(0);
  }

  // Poll for async completion
  const TIMEOUT = parseInt(process.env.SANDBOX_TIMEOUT || "30000", 10);
  const start = Date.now();
  const poll = setInterval(() => {
    if (sandbox.__result__ !== undefined) {
      clearInterval(poll);
      const r = sandbox.__result__;
      if (r && "err" in r) {
        process.stdout.write(JSON.stringify({ error: r.err, logs: logLines }));
      } else {
        process.stdout.write(JSON.stringify({ result: r?.ok ?? null, logs: logLines }));
      }
      process.exit(0);
    }
    if (Date.now() - start >= TIMEOUT) {
      clearInterval(poll);
      process.stdout.write(JSON.stringify({ error: "Tool execution timed out", logs: logLines }));
      process.exit(0);
    }
  }, 50);
});
