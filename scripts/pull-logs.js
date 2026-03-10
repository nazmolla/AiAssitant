#!/usr/bin/env node

const path = require("path");
const Database = require("better-sqlite3");

function parseArgs(argv) {
  const opts = {
    limit: process.env.NEXUS_LOG_LIMIT || "100",
    level: process.env.NEXUS_LOG_LEVEL || "all",
    source: process.env.NEXUS_LOG_SOURCE || "all",
    baseUrl: process.env.NEXUS_BASE_URL || "",
    apiKey: process.env.NEXUS_API_KEY || "",
    dbPath: process.env.NEXUS_DB_PATH || path.join(process.cwd(), "nexus.db"),
  };

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [k, ...rest] = arg.slice(2).split("=");
    const v = rest.join("=");
    if (!k) continue;
    if (k === "limit" && v) opts.limit = v;
    if (k === "level" && v) opts.level = v;
    if (k === "source" && v) opts.source = v;
    if (k === "baseUrl" && v) opts.baseUrl = v;
    if (k === "apiKey" && v) opts.apiKey = v;
    if (k === "dbPath" && v) opts.dbPath = v;
  }

  return opts;
}

function formatLog(log) {
  const ts = log.created_at || log.ts || new Date().toISOString();
  const lvl = String(log.level || "info").toUpperCase().padEnd(7, " ");
  const src = String(log.source || "-");
  const msg = String(log.message || "").replace(/\s+/g, " ").trim();
  return `${ts} [${lvl}] ${src}: ${msg}`;
}

async function pullFromApi(opts) {
  const url = new URL("/api/logs", opts.baseUrl);
  url.searchParams.set("limit", String(opts.limit || "100"));
  url.searchParams.set("level", String(opts.level || "all"));
  url.searchParams.set("source", String(opts.source || "all"));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API request failed (${res.status}): ${text || res.statusText}`);
  }

  const logs = await res.json();
  if (!Array.isArray(logs)) {
    throw new Error("Unexpected API response shape. Expected array of logs.");
  }

  console.error(`Source: API ${url.origin}/api/logs`);
  console.error(`Rows: ${logs.length}`);
  for (const log of logs) {
    console.log(formatLog(log));
  }
}

function pullFromDb(opts) {
  const db = new Database(opts.dbPath, { readonly: true });
  const level = String(opts.level || "all").toLowerCase();
  const source = String(opts.source || "all").toLowerCase();

  const parsedLimit = String(opts.limit).toLowerCase() === "all"
    ? 1000
    : Math.max(1, Math.min(parseInt(String(opts.limit), 10) || 100, 1000));

  let sql = "SELECT created_at, level, source, message FROM agent_logs";
  const where = [];
  const params = [];

  if (level !== "all") {
    where.push("lower(level) = ?");
    params.push(level);
  }
  if (source !== "all") {
    where.push("lower(source) = ?");
    params.push(source);
  }

  if (where.length > 0) {
    sql += ` WHERE ${where.join(" AND ")}`;
  }
  sql += " ORDER BY id DESC LIMIT ?";
  params.push(parsedLimit);

  const rows = db.prepare(sql).all(...params);
  db.close();

  console.error(`Source: DB fallback (${opts.dbPath})`);
  console.error(`Rows: ${rows.length}`);
  for (const row of rows) {
    console.log(formatLog(row));
  }
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const hasApiConfig = Boolean(opts.baseUrl && opts.apiKey);

  if (hasApiConfig) {
    try {
      await pullFromApi(opts);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`API mode failed, falling back to DB query: ${msg}`);
    }
  } else {
    console.error("API config missing (NEXUS_BASE_URL/NEXUS_API_KEY). Using DB fallback.");
  }

  pullFromDb(opts);
})().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Log pull failed: ${msg}`);
  process.exit(1);
});
