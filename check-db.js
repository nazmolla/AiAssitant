const Database = require("better-sqlite3");
const db = new Database("nexus.db");
console.log("LLM providers:", db.prepare("SELECT count(*) as c FROM llm_providers").get());
console.log("MCP servers:", db.prepare("SELECT count(*) as c FROM mcp_servers").get());
console.log("Tool policies:", db.prepare("SELECT count(*) as c FROM tool_policies").get());
console.log("Users:", db.prepare("SELECT count(*) as c FROM users").get());
db.close();
