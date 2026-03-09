#!/usr/bin/env node

const baseUrl = process.env.NEXUS_BASE_URL || process.argv[2];
const token = process.env.NEXUS_API_KEY || process.argv[3];
const level = process.env.NEXUS_LOG_LEVEL || process.argv[4] || "all";
const source = process.env.NEXUS_LOG_SOURCE || process.argv[5] || "all";
const sinceArg = process.env.NEXUS_LOG_SINCE_ID || process.argv[6] || "0";

if (!baseUrl || !token) {
  console.error("Usage: node scripts/stream-logs.js <baseUrl> <apiKey> [level] [source] [sinceId]");
  console.error("Example: node scripts/stream-logs.js http://localhost:3000 nxk_xxx warning scheduler 0");
  process.exit(1);
}

const sinceId = Number.parseInt(String(sinceArg), 10);
const safeSinceId = Number.isFinite(sinceId) && sinceId >= 0 ? sinceId : 0;

const url = new URL("/api/logs/stream", baseUrl);
url.searchParams.set("level", level);
url.searchParams.set("source", source);
url.searchParams.set("sinceId", String(safeSinceId));

function formatLog(log) {
  const ts = log.created_at || new Date().toISOString();
  const lvl = (log.level || "info").toString().toUpperCase().padEnd(7, " ");
  const src = (log.source || "-").toString();
  const msg = (log.message || "").toString();
  return `${ts} [${lvl}] ${src} ${msg}`;
}

(async () => {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    console.error(`Failed to connect (${res.status}): ${text || res.statusText}`);
    process.exit(1);
  }

  console.error(`Connected to ${url.toString()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const lines = rawEvent.split("\n");
      let eventType = "message";
      const dataLines = [];

      for (const line of lines) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }

      if (dataLines.length === 0) continue;

      try {
        const payload = JSON.parse(dataLines.join("\n"));
        if (eventType === "log") {
          console.log(formatLog(payload));
        } else if (eventType === "cursor") {
          console.error(`cursor=${payload.sinceId}`);
        } else if (eventType === "heartbeat") {
          // keep-alive event
        } else {
          console.error(`${eventType}: ${JSON.stringify(payload)}`);
        }
      } catch {
        console.error(`unparsed ${eventType}: ${dataLines.join("\\n")}`);
      }
    }
  }

  console.error("Log stream ended.");
})().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Stream failed: ${msg}`);
  process.exit(1);
});
