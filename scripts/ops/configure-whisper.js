#!/usr/bin/env node
/**
 * Configure local Whisper in Nexus app_config directly via the database.
 */
const path = require('path');
const db = require('better-sqlite3')(path.join(__dirname, 'nexus.db'));

db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").run('whisper_local_enabled', 'true');
db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").run('whisper_local_url', 'http://localhost:8083');
db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").run('whisper_local_model', 'ggml-small');

// Verify
const rows = db.prepare("SELECT key, value FROM app_config WHERE key LIKE 'whisper%'").all();
console.log('Local Whisper config:');
rows.forEach(r => console.log(`  ${r.key} = ${r.value}`));

db.close();
