#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "  🚀 Развертывание MSX Home Server в Proxmox VE (LXC)"
echo "=========================================================="

# 1. Update and install system dependencies
echo "[1/4] Обновление системы и установка curl, git..."
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ca-certificates

# 2. Check and install Node.js 20 LTS if needed
if ! command -v node &> /dev/null; then
    echo "[2/4] Node.js не найден. Устанавливаем Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "[2/4] Node.js уже установлен: $(node -v)"
fi

# 3. Install project dependencies and build frontend
echo "[3/4] Установка зависимостей и сборка приложения..."
npm install --legacy-peer-deps
npm run build

# 4. Configure systemd service for auto-start on boot
echo "[4/4] Настройка службы systemd (msx-server)..."
SERVICE_PATH="/etc/systemd/system/msx-server.service"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NPX_BIN="$(which npx)"

cat <<EOF > "$SERVICE_PATH"
[Unit]
Description=Media Station X Home Server Studio
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
ExecStart=$NPX_BIN tsx server.ts
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable msx-server
systemctl restart msx-server

IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo "=========================================================="
echo "  🎉 MSX Home Server успешно запущен в Proxmox LXC!"
echo "=========================================================="
echo "  Статус службы: $(systemctl is-active msx-server)"
echo "  Панель управления (с ПК):   http://${IP_ADDR}:3000"
echo ""
echo "  Параметр запуска для ТВ в Media Station X:"
echo "     http://${IP_ADDR}:3000/start.json"
echo "  или:"
echo "     http://${IP_ADDR}:3000/api/msx/start.json"
echo "=========================================================="
