#!/bin/bash
cd ~/AiAssistant

echo "=== Recent Errors ==="
sqlite3 nexus.db "SELECT datetime(created_at,'localtime') as ts, level, substr(message,1,120) FROM agent_logs WHERE level IN ('error','critical') ORDER BY created_at DESC LIMIT 10"

echo ""
echo "=== Scheduler Status ==="
sqlite3 nexus.db "SELECT name, status, datetime(last_run_at,'localtime') as last_run FROM scheduled_tasks ORDER BY last_run_at DESC LIMIT 5"

echo ""
echo "=== Service ==="
systemctl status nexus-agent --no-pager | head -5

echo ""
echo "=== MCP Connections ==="
sqlite3 nexus.db "SELECT name, transport_type FROM mcp_servers"

echo ""
echo "=== Ollama ==="
curl -s http://localhost:11434/api/tags | head -5

echo ""
echo "=== DB Size ==="
ls -lh nexus.db | awk '{print $5}'
sqlite3 nexus.db "SELECT COUNT(*) || ' knowledge entries' FROM user_knowledge"
