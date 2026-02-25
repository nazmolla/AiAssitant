const db = require("better-sqlite3")("/home/<user>/nexus-agent/nexus.db");

// List tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("TABLES:", tables.map(r => r.name).join(", "));

// Check users table
try {
  const users = db.prepare("SELECT id, email, role, provider_id FROM users").all();
  console.log("USERS:", JSON.stringify(users, null, 2));
} catch (e) {
  console.log("USERS TABLE ERROR:", e.message);
}

// Check user_knowledge columns
try {
  const cols = db.prepare("PRAGMA table_info(user_knowledge)").all();
  console.log("user_knowledge columns:", cols.map(c => c.name).join(", "));
} catch (e) {
  console.log("user_knowledge error:", e.message);
}

// Check threads columns
try {
  const cols = db.prepare("PRAGMA table_info(threads)").all();
  console.log("threads columns:", cols.map(c => c.name).join(", "));
} catch (e) {
  console.log("threads error:", e.message);
}

// Check mcp_servers columns
try {
  const cols = db.prepare("PRAGMA table_info(mcp_servers)").all();
  console.log("mcp_servers columns:", cols.map(c => c.name).join(", "));
} catch (e) {
  console.log("mcp_servers error:", e.message);
}

// Check user_profiles
try {
  const cols = db.prepare("PRAGMA table_info(user_profiles)").all();
  console.log("user_profiles columns:", cols.map(c => c.name).join(", "));
} catch (e) {
  console.log("user_profiles error:", e.message);
}

// Check channel_user_mappings
try {
  const cols = db.prepare("PRAGMA table_info(channel_user_mappings)").all();
  console.log("channel_user_mappings columns:", cols.map(c => c.name).join(", "));
} catch (e) {
  console.log("channel_user_mappings error:", e.message);
}

db.close();
