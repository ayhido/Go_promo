#!/usr/bin/env bash
# Обновление программы на сервере: bash /opt/gopromo/deploy/update.sh
# Настройки (.env), заказы (data/) и резервные копии не трогаются.
set -euo pipefail
APP_DIR=/opt/gopromo
BRANCH="${BRANCH:-claude/jarvis-repo-0fj8rj}"
[ "$(id -u)" -eq 0 ] || { echo "Запустите от root (или через sudo)."; exit 1; }

cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR"
cp data/db.json "backups/db-before-update-$(date +%F-%H%M).json" 2>/dev/null || true
git fetch -q origin "$BRANCH"
git checkout -q -B "$BRANCH" "origin/$BRANCH"
npm ci --omit=dev --no-audit --no-fund
chown -R gopromo:gopromo "$APP_DIR"
systemctl restart gopromo
sleep 2
systemctl --no-pager --lines=6 status gopromo
echo "Обновлено до версии: $(git log -1 --format='%h %s')"
