const db = require("better-sqlite3")("nexus.db");
const msgs = db.prepare("SELECT id, role, content, tool_calls, created_at FROM messages ORDER BY id DESC LIMIT 20").all();
msgs.forEach((m) => {
  const content = (m.content || "").slice(0, 60).replace(/\n/g, " ");
  const tools = m.tool_calls ? "HAS_TOOLS" : "no_tools";
  console.log(`${m.id} | ${m.role} | ${tools} | ${content} | ${m.created_at}`);
});
db.close();
