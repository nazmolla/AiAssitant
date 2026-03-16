#!/usr/bin/env python3
"""
Remote database analyzer - runs on production server via SSH
"""

import sqlite3
import os
from pathlib import Path

db_path = Path.home() / "AiAssistant" / "nexus.db"
print(f"🔍 Analyzing production database: {db_path}")
print(f"   File size: {db_path.stat().st_size / (1024*1024):.1f} MB\n")

conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

# 1. Get rough table storage
print("═" * 70)
print("TABLE SIZES")
print("═" * 70)

cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
tables = [row[0] for row in cursor.fetchall()]

for table in tables:
    try:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        if count > 0:
            print(f"  {table:30} {count:>12,} rows")
    except:
        pass

# 2. Focus on knowledge tables
print("\n" + "═" * 70)
print("USER_KNOWLEDGE TABLE (Detailed Analysis)")
print("═" * 70)

cursor.execute("SELECT COUNT(*) FROM user_knowledge")
total_knowledge = cursor.fetchone()[0]
print(f"\nTotal knowledge records: {total_knowledge:,}\n")

# Stats by user
cursor.execute("""
SELECT 
    COALESCE(user_id, '[GLOBAL]') as user_id,
    COUNT(*) as record_count,
    ROUND(AVG(LENGTH(COALESCE(value, ''))), 0) as avg_value_len,
    MAX(LENGTH(COALESCE(value, ''))) as max_value_len,
    ROUND(SUM(LENGTH(COALESCE(value, ''))), 0) as total_value_bytes,
    ROUND(SUM(LENGTH(COALESCE(source_context, ''))), 0) as total_context_bytes
FROM user_knowledge
GROUP BY COALESCE(user_id, '[GLOBAL]')
ORDER BY total_value_bytes DESC
LIMIT 20
""")

print(f"{'USER_ID':<36} {'COUNT':>8} {'AVG LEN':>10} {'MAX LEN':>10} {'VALUE MB':>8} {'CONTEXT MB':>10}")
print("─" * 100)

total_val_mb = 0
total_ctx_mb = 0

for row in cursor.fetchall():
    user_id, count, avg_len, max_len, total_bytes, total_ctx_bytes = row
    val_mb = (total_bytes or 0) / (1024*1024)
    ctx_mb = (total_ctx_bytes or 0) / (1024*1024)
    total_val_mb += val_mb
    total_ctx_mb += ctx_mb
    print(f"{user_id:<36} {count:>8,} {avg_len:>10.0f} {max_len:>10,} {val_mb:>8.2f} {ctx_mb:>10.2f}")

print(f"\n  TOTAL VALUE STORAGE: {total_val_mb:.2f} MB")
print(f"  TOTAL CONTEXT STORAGE: {total_ctx_mb:.2f} MB")

# 3. Knowledge embeddings
print("\n" + "═" * 70)
print("KNOWLEDGE_EMBEDDINGS TABLE")
print("═" * 70)

cursor.execute("SELECT COUNT(*) FROM knowledge_embeddings")
embedding_count = cursor.fetchone()[0]
print(f"\nTotal embeddings: {embedding_count:,}")

if embedding_count > 0:
    cursor.execute("""
    SELECT 
        COUNT(*) as count,
        ROUND(AVG(LENGTH(embedding)), 0) as avg_len,
        ROUND(SUM(LENGTH(embedding)) / (1024.0 * 1024.0), 2) as total_mb
    FROM knowledge_embeddings
    """)
    
    count, avg_len, total_mb = cursor.fetchone()
    print(f"Average embedding size: {avg_len:,.0f} bytes")
    print(f"Total embeddings storage: ~{total_mb:.2f} MB")

# 4. Messages table (could be large with attachments)
print("\n" + "═" * 70)
print("MESSAGES TABLE")
print("═" * 70)

cursor.execute("SELECT COUNT(*) FROM messages")
msg_count = cursor.fetchone()[0]
print(f"\nTotal messages: {msg_count:,}")

if msg_count > 0:
    cursor.execute("""
    SELECT
        ROUND(AVG(LENGTH(COALESCE(content, ''))), 0) as avg_content_len,
        ROUND(SUM(LENGTH(COALESCE(content, ''))) / (1024.0 * 1024.0), 2) as total_content_mb
    FROM messages
    """)
    
    avg_len, total_mb = cursor.fetchone()
    print(f"Average message content: {avg_len:,.0f} bytes")
    print(f"Total message content storage: ~{total_mb:.2f} MB")

# 5. Agent logs
print("\n" + "═" * 70)
print("AGENT_LOGS TABLE")
print("═" * 70)

cursor.execute("SELECT COUNT(*) FROM agent_logs")
log_count = cursor.fetchone()[0]
print(f"\nTotal log entries: {log_count:,}")

if log_count > 0:
    cursor.execute("""
    SELECT
        ROUND(AVG(LENGTH(COALESCE(message, ''))), 0) as avg_msg_len,
        ROUND(AVG(LENGTH(COALESCE(metadata, ''))), 0) as avg_meta_len,
        ROUND(SUM(LENGTH(COALESCE(message, ''))+LENGTH(COALESCE(metadata, ''))) / (1024.0 * 1024.0), 2) as total_mb
    FROM agent_logs
    """)
    
    avg_msg, avg_meta, total_mb = cursor.fetchone()
    print(f"Average log message: {avg_msg:,.0f} bytes")
    print(f"Average log metadata: {avg_meta:,.0f} bytes")
    print(f"Total logs storage: ~{total_mb:.2f} MB")

# 6. Top storage consumers
print("\n" + "═" * 70)
print("TOP RECORDS BY SIZE (user_knowledge VALUE field)")
print("═" * 70 )

cursor.execute("""
SELECT 
    id,
    user_id,
    entity,
    attribute,
    LENGTH(value) as val_len,
    source_type,
    datetime(last_updated) as updated
FROM user_knowledge
ORDER BY LENGTH(value) DESC
LIMIT 15
""")

print(f"\n{'ID':>6} {'USER_ID':<18} {'VAL_LEN':>8} {'ENTITY':<25} {'ATTR':<20} {'TYPE':>8}")
print("─" * 95)

for row in cursor.fetchall():
    id, user_id, entity, attr, val_len, source_type, updated = row
    user_disp = (user_id[:16] + "..") if user_id and len(user_id) > 18 else (user_id or "[NULL]")
    entity_disp = (entity[:23] + "..") if entity and len(entity) > 25 else entity
    attr_disp = (attr[:18] + "..") if attr and len(attr) > 20 else attr
    print(f"{id:>6} {user_disp:<18} {val_len:>8,} {entity_disp:<25} {attr_disp:<20} {source_type:>8}")

conn.close()
print("\n" + "═" * 70)
