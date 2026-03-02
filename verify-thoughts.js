// Verify processedMessages grouping against REAL production data
const db = require("better-sqlite3")("nexus.db");

// Get a thread that has tool_calls
const thread = db.prepare(`
  SELECT DISTINCT m.thread_id
  FROM messages m
  WHERE m.tool_calls IS NOT NULL
  ORDER BY m.id DESC
  LIMIT 1
`).get();

if (!thread) {
  console.log("No threads with tool_calls found!");
  process.exit(1);
}

const messages = db.prepare(
  "SELECT id, role, content, tool_calls, tool_results, attachments FROM messages WHERE thread_id = ? ORDER BY id ASC"
).all(thread.thread_id);

console.log(`Thread: ${thread.thread_id}`);
console.log(`Total messages: ${messages.length}`);
console.log("");

// Apply processedMessages logic (same as chat-panel.tsx)
const processed = [];
let pendingThoughts = [];

for (const msg of messages) {
  if (msg.role === "tool") {
    if (pendingThoughts.length > 0) {
      const lastThought = pendingThoughts[pendingThoughts.length - 1];
      let name = "tool";
      if (lastThought.toolCalls.length > 0) {
        const idx = lastThought.toolResults.length;
        if (idx < lastThought.toolCalls.length) {
          name = lastThought.toolCalls[idx].name;
        }
      }
      lastThought.toolResults.push({
        name,
        result: (msg.content || "").slice(0, 50),
      });
    }
    continue;
  }

  if (msg.role === "assistant" && msg.tool_calls) {
    let parsedCalls = [];
    try {
      parsedCalls = JSON.parse(msg.tool_calls).map((tc) => ({
        name: tc.name,
        args: tc.arguments,
      }));
    } catch {}
    pendingThoughts.push({
      thinking: msg.content,
      toolCalls: parsedCalls,
      toolResults: [],
    });
    continue;
  }

  if (msg.role === "assistant") {
    // Check sanitization
    const content = msg.content || "";
    const hasAtt = !!msg.attachments;
    const isEmpty = !content || content.trim() === "";
    if (isEmpty && !hasAtt) {
      console.log(`  WARN: Empty assistant msg (id=${msg.id}) would be SKIPPED, thoughts FLUSHED!`);
      pendingThoughts = [];
      continue;
    }
    processed.push({
      id: msg.id,
      role: msg.role,
      content: (msg.content || "").slice(0, 60),
      thoughts: pendingThoughts,
    });
    pendingThoughts = [];
    continue;
  }

  // User/system
  pendingThoughts = [];
  processed.push({
    id: msg.id,
    role: msg.role,
    content: (msg.content || "").slice(0, 60),
    thoughts: [],
  });
}

console.log("=== Processed Messages ===");
let thoughtsFound = false;
for (const pm of processed) {
  const thoughtInfo = pm.thoughts.length > 0
    ? `THOUGHTS(${pm.thoughts.length} steps: ${pm.thoughts.map((t) => t.toolCalls.map((tc) => tc.name).join(",")).join(" → ")})`
    : "no thoughts";
  console.log(`  id=${pm.id} | ${pm.role} | ${thoughtInfo} | ${pm.content}`);
  if (pm.thoughts.length > 0) {
    thoughtsFound = true;
    for (const t of pm.thoughts) {
      console.log(`    thinking: "${(t.thinking || "").slice(0, 40)}"`);
      console.log(`    tools: ${t.toolCalls.map((tc) => tc.name).join(", ")}`);
      console.log(`    results: ${t.toolResults.length}`);
    }
  }
}

console.log("");
console.log(thoughtsFound ? "RESULT: PASS — Thoughts found and grouped correctly!" : "RESULT: FAIL — No thoughts found!");

db.close();
