const db = require("better-sqlite3")("nexus.db");

// Find threads with tool_calls
const threadsWithTools = db.prepare(`
  SELECT DISTINCT m.thread_id, t.title
  FROM messages m
  JOIN threads t ON t.id = m.thread_id
  WHERE m.tool_calls IS NOT NULL
  ORDER BY m.id DESC
  LIMIT 5
`).all();

console.log("=== Threads with tool usage ===");
for (const t of threadsWithTools) {
  console.log(`Thread: ${t.thread_id} | Title: ${t.title}`);
  const msgs = db.prepare(
    "SELECT id, role, content, tool_calls, created_at FROM messages WHERE thread_id = ? ORDER BY id ASC"
  ).all(t.thread_id);
  for (const m of msgs) {
    const content = (m.content || "").slice(0, 80).replace(/\n/g, " ");
    const tools = m.tool_calls ? "HAS_TOOLS(" + JSON.parse(m.tool_calls).map(tc => tc.name).join(",") + ")" : "no_tools";
    console.log(`  ${m.id} | ${m.role} | ${tools} | ${content}`);
  }
  console.log("");
}

// Also check total tool-call messages count
const toolCount = db.prepare("SELECT COUNT(*) as c FROM messages WHERE tool_calls IS NOT NULL").get();
console.log(`Total messages with tool_calls: ${toolCount.c}`);

db.close();
