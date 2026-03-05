#!/usr/bin/env node
/**
 * Configure local STT (Whisper) and TTS (Piper) in the Nexus database.
 */
const path = require('path');
const appDir = '/home/nexusservice/AiAssistant';
const db = require(path.join(appDir, 'node_modules/better-sqlite3'))(
  path.join(appDir, 'nexus.db')
);

// 1. Configure local Whisper STT in app_config
const upsert = db.prepare(
  `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
);

upsert.run('whisper_local_enabled', 'true');
upsert.run('whisper_local_url', 'http://127.0.0.1:8083');
upsert.run('whisper_local_model', 'whisper-1');
console.log('✓ Local Whisper STT configured (http://127.0.0.1:8083)');

// 2. Add local TTS provider (LiteLLM-type pointing to Piper)
const crypto = require('crypto');
const ttsId = crypto.randomUUID();

// Check if a local TTS provider already exists
const existing = db.prepare(
  `SELECT id FROM llm_providers WHERE purpose = 'tts' AND label LIKE '%Local%'`
).get();

if (existing) {
  // Update existing
  db.prepare(
    `UPDATE llm_providers SET config_json = ?, provider_type = 'litellm' WHERE id = ?`
  ).run(
    JSON.stringify({
      baseURL: 'http://127.0.0.1:8084/v1',
      apiKey: 'local',
      model: 'tts-1',
    }),
    existing.id
  );
  console.log('✓ Local TTS provider updated (http://127.0.0.1:8084)');
} else {
  // Insert new
  db.prepare(
    `INSERT INTO llm_providers (id, label, provider_type, purpose, config_json, is_default)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    ttsId,
    'Local Piper TTS',
    'litellm',
    'tts',
    JSON.stringify({
      baseURL: 'http://127.0.0.1:8084/v1',
      apiKey: 'local',
      model: 'tts-1',
    }),
    0
  );
  console.log('✓ Local TTS provider added (http://127.0.0.1:8084)');
}

// 3. Check if a local STT provider already exists (for dedicated cloud bypass)
const existingStt = db.prepare(
  `SELECT id FROM llm_providers WHERE purpose = 'stt' AND label LIKE '%Local%'`
).get();

if (existingStt) {
  db.prepare(
    `UPDATE llm_providers SET config_json = ?, provider_type = 'litellm' WHERE id = ?`
  ).run(
    JSON.stringify({
      baseURL: 'http://127.0.0.1:8083/v1',
      apiKey: 'local',
      model: 'whisper-1',
    }),
    existingStt.id
  );
  console.log('✓ Local STT provider updated (http://127.0.0.1:8083)');
} else {
  db.prepare(
    `INSERT INTO llm_providers (id, label, provider_type, purpose, config_json, is_default)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    'Local Whisper STT',
    'litellm',
    'stt',
    JSON.stringify({
      baseURL: 'http://127.0.0.1:8083/v1',
      apiKey: 'local',
      model: 'whisper-1',
    }),
    0
  );
  console.log('✓ Local STT provider added (http://127.0.0.1:8083)');
}

// Show all providers
const providers = db.prepare(
  `SELECT label, provider_type, purpose, is_default FROM llm_providers ORDER BY purpose`
).all();
console.log('\nAll LLM providers:');
providers.forEach(p => {
  console.log(`  [${p.purpose}] ${p.label} (${p.provider_type})${p.is_default ? ' *default*' : ''}`);
});

// Show whisper config
const whisperConfig = db.prepare(
  `SELECT key, value FROM app_config WHERE key LIKE 'whisper_%'`
).all();
console.log('\nWhisper config:');
whisperConfig.forEach(c => console.log(`  ${c.key} = ${c.value}`));

db.close();
