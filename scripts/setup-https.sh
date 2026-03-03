#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  Nexus Agent — HTTPS Setup (nginx reverse proxy)
#  Run on the Jetson: bash setup-https.sh
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

echo "=== Nexus Agent HTTPS Setup ==="

# 1. Generate self-signed cert (10 years)
echo "[1/4] Generating self-signed SSL certificate..."
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/nexus.key \
  -out /etc/nginx/ssl/nexus.crt \
  -subj '/CN=YOUR_SERVER_IP/O=Nexus Agent/C=US' \
  -addext 'subjectAltName=IP:YOUR_SERVER_IP'
echo "  Certificate: /etc/nginx/ssl/nexus.crt (10-year validity)"

# 2. Write nginx config
echo "[2/4] Writing nginx config..."
cat > /tmp/nexus-agent.conf << 'EOF'
# Nexus Agent — HTTPS reverse proxy
# Proxies HTTPS:443 → Next.js on localhost:3000

# Redirect HTTP → HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name _;
    return 301 https://$host$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name _;

    ssl_certificate     /etc/nginx/ssl/nexus.crt;
    ssl_certificate_key /etc/nginx/ssl/nexus.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    # Proxy to Next.js
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_buffering off;

        # SSE support (critical for chat streaming)
        proxy_cache off;
        chunked_transfer_encoding on;
    }

    # Max upload size (for audio files up to 25MB + attachments)
    client_max_body_size 30m;
}
EOF
sudo mv /tmp/nexus-agent.conf /etc/nginx/sites-available/nexus-agent
echo "  Config: /etc/nginx/sites-available/nexus-agent"

# 3. Enable site, disable default
echo "[3/4] Enabling site..."
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/nexus-agent /etc/nginx/sites-enabled/nexus-agent

# 4. Test and reload
echo "[4/4] Testing and reloading nginx..."
sudo nginx -t
sudo systemctl reload nginx
echo ""
echo "=== HTTPS Setup Complete ==="
echo "Access: https://YOUR_SERVER_IP"
echo ""
echo "NOTE: The certificate is self-signed. Browsers will show a warning."
echo "Accept the certificate once to enable mic access (getUserMedia)."
