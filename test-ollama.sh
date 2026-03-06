#!/bin/bash
echo "=== Ollama Model Status ==="
curl -s http://localhost:11434/api/ps | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('models', []):
    print(f\"  Model: {m['name']}\")
    print(f\"  Size: {m['size']/1e9:.1f} GB\")
    print(f\"  VRAM: {m['size_vram']/1e9:.1f} GB\")
    print(f\"  Context: {m.get('context_length', '?')}\")
"

echo ""
echo "=== Testing chat speed (simple 'hi') ==="
START_NS=$(date +%s%N)
curl -s --max-time 60 http://localhost:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.5","messages":[{"role":"user","content":"hi"}],"stream":false}' \
  -o /tmp/ollama-test.json
END_NS=$(date +%s%N)
WALL_MS=$(( (END_NS - START_NS) / 1000000 ))
echo "Wall clock: ${WALL_MS}ms"

python3 -c "
import json
with open('/tmp/ollama-test.json') as f:
    d = json.load(f)
if 'error' in d:
    print(f'ERROR: {d[\"error\"]}')
else:
    total = d.get('total_duration', 0) / 1e9
    load = d.get('load_duration', 0) / 1e9
    prompt_eval = d.get('prompt_eval_duration', 0) / 1e9
    eval_dur = d.get('eval_duration', 0) / 1e9
    eval_count = d.get('eval_count', 0)
    tps = eval_count / eval_dur if eval_dur > 0 else 0
    msg = d.get('message', {}).get('content', '')[:200]
    print(f'  Total: {total:.1f}s')
    print(f'  Model load: {load:.1f}s')
    print(f'  Prompt eval: {prompt_eval:.1f}s')
    print(f'  Generation: {eval_dur:.1f}s ({eval_count} tokens)')
    print(f'  Speed: {tps:.1f} tokens/sec')
    print(f'  Response: {msg}')
"

echo ""
echo "=== System Resources ==="
free -h | head -3
echo ""
nvidia-smi 2>/dev/null || echo "No GPU detected"
echo ""
nproc
cat /proc/cpuinfo | grep "model name" | head -1
