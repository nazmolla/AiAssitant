#!/usr/bin/env python3
"""
Analyze SQLite database to identify large knowledge records.
"""

import sqlite3
import os
import json
from pathlib import Path

# Connect to the database
db_path = Path(os.getcwd()) / "nexus.db"
print(f"🔍 Analyzing database: {db_path}")
print(f"   File size: {db_path.stat().st_size / (1024*1024):.1f} MB\n")

if not db_path.exists():
    print(f"❌ Database not found at {db_path}")
    exit(1)

conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

# 1. Get table sizes
print("═" * 70)
print("TABLE SIZES")
print("═" * 70)

cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
tables = [row[0] for row in cursor.fetchall()]

table_sizes = {}
for table in tables:
    cursor.execute(f"SELECT COUNT(*) FROM {table}")
    count = cursor.fetchone()[0]
    
    # Estimate size (rough approximation via page_count)
    cursor.execute(f"SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size() WHERE (SELECT COUNT(*) FROM {table}) > 0;")
    result = cursor.fetchone()
    size_estimate = result[0] if result and result[0] else 0
    
    table_sizes[table] = (count, size_estimate)
    if count > 0:
        print(f"  {table:30} {count:8,} rows")

# 2. Analyze user_knowledge table specifically
print("\n" + "═" * 70)
print("USER_KNOWLEDGE TABLE ANALYSIS")
print("═" * 70)

cursor.execute("SELECT COUNT(*) FROM user_knowledge")
total_knowledge = cursor.fetchone()[0]
print(f"\nTotal records: {total_knowledge:,}\n")

# Get stats by user
cursor.execute("""
SELECT 
    COALESCE(user_id, '[GLOBAL]') as user_id,
    COUNT(*) as record_count,
    ROUND(AVG(LENGTH(COALESCE(value, ''))), 2) as avg_value_len,
    MAX(LENGTH(COALESCE(value, ''))) as max_value_len,
    ROUND(AVG(LENGTH(COALESCE(source_context, ''))), 2) as avg_context_len,
    ROUND(AVG(LENGTH(COALESCE(entity, ''))), 2) as avg_entity_len,
    ROUND(AVG(LENGTH(COALESCE(attribute, ''))), 2) as avg_attr_len
FROM user_knowledge
GROUP BY COALESCE(user_id, '[GLOBAL]')
ORDER BY record_count DESC
""")

print(f"{'USER_ID':<36} {'COUNT':>8} {'AVG VALUE':>10} {'MAX VALUE':>10} {'AVG CONTEXT':>12} {'AVG ENTITY':>10} {'AVG ATTR':>10}")
print("─" * 110)
for row in cursor.fetchall():
    user_id, count, avg_val, max_val, avg_ctx, avg_ent, avg_attr = row
    print(f"{user_id:<36} {count:>8,} {avg_val:>10.0f} {max_val:>10,} {avg_ctx:>12.0f} {avg_ent:>10.0f} {avg_attr:>10.0f}")

# 3. Largest individual records
print("\n" + "═" * 70)
print("TOP 20 LARGEST RECORDS (by value length)")
print("═" * 70)

cursor.execute("""
SELECT 
    id,
    COALESCE(user_id, '[GLOBAL]') as user_id,
    entity,
    attribute,
    LENGTH(value) as value_len,
    LENGTH(COALESCE(source_context, '')) as context_len,
    source_type,
    last_updated
FROM user_knowledge
ORDER BY LENGTH(value) DESC
LIMIT 20
""")

print(f"\n{'ID':>6} {'USER_ID':<25} {'VALUE LEN':>10} {'CONTEXT':>10} {'ENTITY':<20} {'ATTRIBUTE':<20} {'TYPE':<8}")
print("─" * 125)

for row in cursor.fetchall():
    id, user_id, entity, attribute, value_len, context_len, source_type, updated = row
    user_display = user_id[:20] + ".." if len(user_id) > 22 else user_id
    entity_display = entity[:18] if entity else "(none)"
    attr_display = attribute[:18] if attribute else "(none)"
    print(f"{id:>6} {user_display:<25} {value_len:>10,} {context_len:>10,} {entity_display:<20} {attr_display:<20} {source_type:<8}")

# 4. Analyze knowledge_embeddings
print("\n" + "═" * 70)
print("KNOWLEDGE_EMBEDDINGS TABLE ANALYSIS")
print("═" * 70)

cursor.execute("SELECT COUNT(*) FROM knowledge_embeddings")
embedding_count = cursor.fetchone()[0]
print(f"\nTotal embeddings: {embedding_count:,}")

if embedding_count > 0:
    cursor.execute("""
    SELECT 
        COUNT(*) as count,
        ROUND(AVG(LENGTH(embedding)), 0) as avg_len,
        MAX(LENGTH(embedding)) as max_len,
        MIN(LENGTH(embedding)) as min_len
    FROM knowledge_embeddings
    """)
    
    count, avg_len, max_len, min_len = cursor.fetchone()
    print(f"Average embedding size: {avg_len:,.0f} bytes")
    print(f"Max embedding size: {max_len:,} bytes")
    print(f"Min embedding size: {min_len:,} bytes")
    print(f"Total embeddings storage: ~{(embedding_count * avg_len) / (1024*1024):.1f} MB")

# 5. Source types distribution
print("\n" + "═" * 70)
print("SOURCE TYPE DISTRIBUTION")
print("═" * 70)

cursor.execute("""
SELECT 
    source_type,
    COUNT(*) as count,
    ROUND(AVG(LENGTH(value)), 0) as avg_value_len,
    ROUND(SUM(LENGTH(value)) / (1024.0 * 1024.0), 2) as total_mb
FROM user_knowledge
GROUP BY source_type
ORDER BY count DESC
""")

print(f"\n{'SOURCE TYPE':<15} {'COUNT':>10} {'AVG VALUE LEN':>15} {'TOTAL MB':>10}")
print("─" * 55)
for row in cursor.fetchall():
    source_type, count, avg_len, total_mb = row
    print(f"{source_type:<15} {count:>10,} {avg_len:>15,.0f} {total_mb:>10.2f}")

# 6. Potential issues
print("\n" + "═" * 70)
print("POTENTIAL OPTIMIZATION OPPORTUNITIES")
print("═" * 70)

cursor.execute("""
SELECT 
    source_type,
    COUNT(*) as count
FROM user_knowledge
WHERE LENGTH(value) > 10000
GROUP BY source_type
""")

large_records = cursor.fetchall()
if large_records:
    print(f"\n⚠️  Records with value > 10 KB:")
    for source_type, count in large_records:
        print(f"   {source_type}: {count:,} records")
else:
    print("\n✓ No extremely large individual records (>10 KB)")

# Check for duplicates or near-duplicates
cursor.execute("""
SELECT 
    entity,
    attribute,
    COUNT(*) as count
FROM user_knowledge
GROUP BY entity, attribute
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 10
""")

duplicates = cursor.fetchall()
if duplicates:
    print(f"\n⚠️  Potential duplicate entries (same entity+attribute):")
    for entity, attribute, count in duplicates:
        print(f"   {entity} / {attribute}: {count} versions")

conn.close()
print("\n" + "═" * 70)
