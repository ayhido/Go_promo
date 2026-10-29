#!/usr/bin/env bash
# ===================================================================
#  Установка «Мастер на час» на чистый сервер Ubuntu 22.04 / 24.04.
#  Запуск (под root):
#    bash <(curl -fsSL https://raw.githubusercontent.com/ayhido/go_promo/claude/jarvis-repo-0fj8rj/deploy/install.sh)
#  Что делает: Node.js, Caddy (HTTPS сам), программа как служба
#  с автозапуском, брандмауэр, ежедневные резервные копии заказов.
#  Повторный запуск безопасен: настройки и заказы не трогаются.
# ===================================================================
set -euo pipefail

REPO="${REPO:-https://github.com/ayhido/go_promo.git}"
BRANCH="${BRANCH:-claude/jarvis-repo-0fj8rj}"
APP_DIR=/opt/gopromo
APP_USER=gopromo

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ask() { local v; read -r -p "$1" v </dev/tty; printf '%s' "$v"; }

[ "$(id -u)" -eq 0 ] || { echo "Запустите от root (или через sudo)."; exit 1; }

# ===== настройки =====
DOMAIN="${DOMAIN:-}"
if [ -z "$DOMAIN" ]; then
  DOMAIN=$(ask "Домен сайта [mendusmaster.ru]: ")
  DOMAIN="${DOMAIN:-mendusmaster.ru}"
fi
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#www.}"; DOMAIN="${DOMAIN%/}"

say "Устанавливаю системные пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg ufw debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  say "Устанавливаю Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  say "Устанавливаю Caddy (веб-сервер с автоматическим HTTPS)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

say "Скачиваю программу"
git config --global --add safe.directory "$APP_DIR"  # папка принадлежит gopromo, git под root иначе откажется
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund

# ===== .env: создаём один раз, дальше только дописываем недостающее =====
ENV="$APP_DIR/.env"
set_env() { grep -q "^$1=" "$ENV" 2>/dev/null || echo "$1=$2" >> "$ENV"; }
if [ ! -f "$ENV" ]; then
  say "Настройка бота"
  TOKEN=$(ask "Токен бота от @BotFather: ")
  CHAT=$(ask "Куда присылать заявки (TG_CHAT_ID), например 8399366599: ")
  CITY=$(ask "Город [Новосибирск]: ")
  PHONE=$(ask "Телефон для сайта (можно пусто): ")
  : > "$ENV"
  set_env TG_TOKEN "$TOKEN"
  set_env TG_CHAT_ID "$CHAT"
  set_env DEFAULT_CITY "${CITY:-Новосибирск}"
  set_env SITE_PHONE "$PHONE"
fi
set_env TG_POLLING 1
set_env TG_PROXY off          # сервер за границей — Telegram доступен напрямую
set_env HOST 127.0.0.1        # снаружи — только через Caddy и HTTPS
set_env PORT 3000
set_env TRUST_PROXY 1
set_env ADMIN_PASSWORD "$(node -e "process.stdout.write(require('crypto').randomBytes(10).toString('base64url'))")"
chmod 600 "$ENV"
mkdir -p "$APP_DIR/data" "$APP_DIR/backups"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

say "Служба с автозапуском"
cat > /etc/systemd/system/gopromo.service <<UNIT
[Unit]
Description=Мастер на час: сайт, диспетчер, Telegram-бот
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now gopromo
systemctl restart gopromo

say "HTTPS для $DOMAIN"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}

www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}
CADDY
systemctl enable caddy >/dev/null
systemctl reload caddy || systemctl restart caddy

say "Брандмауэр: открыты только SSH и сайт"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

say "Ежедневная резервная копия заказов (хранится 30 дней)"
cat > /etc/cron.daily/gopromo-backup <<'CRON'
#!/bin/sh
[ -f /opt/gopromo/data/db.json ] || exit 0
cp /opt/gopromo/data/db.json "/opt/gopromo/backups/db-$(date +%F).json"
find /opt/gopromo/backups -name 'db-*.json' -mtime +30 -delete
CRON
chmod +x /etc/cron.daily/gopromo-backup

# ===== итог =====
IP=$(curl -fsS4 --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}' || true)
DNS=$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
PASS=$(grep '^ADMIN_PASSWORD=' "$ENV" | cut -d= -f2-)
sleep 3
echo
echo "================================================================"
echo " Готово! Программа запущена."
echo
echo " IP этого сервера:      $IP"
echo " Домен $DOMAIN сейчас указывает на: ${DNS:-никуда}"
if ! echo " $DNS " | grep -q " $IP "; then
  echo
  echo " ! Домен ещё не указывает на этот сервер. В настройках домена"
  echo "   поставьте A-записи для @ и www на $IP и удалите старые."
  echo "   HTTPS включится сам в течение часа после смены записей."
fi
echo
echo " Сайт:   https://$DOMAIN"
echo " Панель: https://$DOMAIN/dispatcher"
echo " Пароль: $PASS"
echo
echo " Журнал: journalctl -u gopromo -f"
echo " Обновить программу: bash $APP_DIR/deploy/update.sh"
echo "================================================================"
journalctl -u gopromo -n 8 --no-pager || true
