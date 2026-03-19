const path = require('path');
const dbPath = path.join(__dirname, 'nexus.db');
const db = require('better-sqlite3')(dbPath);

// List tables to verify
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.length);

// Check if agent_logs exists
const hasLogs = tables.some(t => t.name === 'agent_logs');
if (!hasLogs) {
  // Try to find log-like tables
  const logTables = tables.filter(t => t.name.toLowerCase().includes('log'));
  console.log('Log tables found:', logTables.map(t => t.name).join(', ') || 'none');
  db.close();
  process.exit(0);
}

const total = db.prepare("SELECT COUNT(id) as c FROM agent_logs WHERE message LIKE '%Invalid tool name%'").get();
console.log('Total tool name errors:', total.c);

const builtin = db.prepare("SELECT COUNT(id) as c FROM agent_logs WHERE message LIKE '%builtin%not connected%'").get();
console.log('Total builtin-not-connected errors:', builtin.c);

const last5 = db.prepare("SELECT created_at, level, message FROM agent_logs WHERE message LIKE '%Invalid tool name%' OR message LIKE '%builtin%not connected%' ORDER BY created_at DESC LIMIT 5").all();
console.log('\nLast 5 errors:');
for (const row of last5) {
  console.log('  [' + row.created_at + '] ' + row.level + ': ' + row.message.slice(0, 120));
}

db.close();
