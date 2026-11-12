#!/usr/bin/env bash
# Установка SFX Studio на macOS. Запускать из папки проекта: ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

command -v git >/dev/null || { echo "Нужен git"; exit 1; }
command -v python3 >/dev/null || { echo "Нужен python3 (3.10+)"; exit 1; }
command -v claude >/dev/null || { echo "Нужен Claude Code: https://claude.com/claude-code"; exit 1; }

if [ ! -d davinci-resolve-mcp ]; then
  git clone https://github.com/samuelgursky/davinci-resolve-mcp.git
fi

cd davinci-resolve-mcp
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --upgrade pip >/dev/null
if [ -f requirements.txt ]; then
  .venv/bin/pip install -r requirements.txt
else
  .venv/bin/pip install "mcp[cli]>=1.30,<2"  # server.py требует mcp 1.x (fastmcp)
fi
cd ..

cat <<MSG

Готово. Осталось 3 шага вручную:
1. DaVinci Resolve Studio: Preferences -> General -> External scripting using -> Local. Resolve держи открытым.
2. Запусти Claude Code в этой папке:  claude
3. Внутри Claude Code набери /mcp -> higgsfield -> Authenticate (войти в Higgsfield).
   Проверка: /mcp должен показать higgsfield и davinci-resolve как connected.

Потом:  /sfx
MSG
