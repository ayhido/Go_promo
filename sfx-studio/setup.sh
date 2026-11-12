#!/usr/bin/env bash
# Установка SFX Studio на macOS или Linux. Запускать из папки проекта: ./setup.sh
# Для Windows используйте setup.ps1
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

command -v git >/dev/null || { echo "Нужен git"; exit 1; }
command -v python3 >/dev/null || { echo "Нужен python3 (3.10–3.12)"; exit 1; }
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

case "$(uname -s)" in
  Darwin)
    API="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting"
    LIB="/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so"
    [ -f "$LIB" ] || LIB="/Applications/DaVinci Resolve Studio.app/Contents/Libraries/Fusion/fusionscript.so"
    ;;
  Linux)
    API="/opt/resolve/Developer/Scripting"
    LIB="/opt/resolve/libs/Fusion/fusionscript.so"
    ;;
  *) echo "Неизвестная ОС. На Windows запустите setup.ps1"; exit 1 ;;
esac
[ -f "$LIB" ] || echo "ВНИМАНИЕ: не найден $LIB — поправьте RESOLVE_SCRIPT_LIB в .mcp.json"

# .mcp.json с абсолютными путями — работает, откуда бы ни запускался claude
python3 - "$ROOT" "$API" "$LIB" <<'PY'
import json, sys, os
root, api, lib = sys.argv[1:4]
srv = os.path.join(root, "davinci-resolve-mcp")
cfg = {"mcpServers": {
  "higgsfield": {"type": "http", "url": "https://mcp.higgsfield.ai/mcp"},
  "davinci-resolve": {
    "command": os.path.join(srv, ".venv", "bin", "python"),
    "args": [os.path.join(srv, "src", "server.py")],
    "env": {"RESOLVE_SCRIPT_API": api, "RESOLVE_SCRIPT_LIB": lib,
            "PYTHONPATH": os.path.join(api, "Modules") + "/"}}}}
with open(os.path.join(root, ".mcp.json"), "w") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
print("Записан .mcp.json")
PY

cat <<MSG

Готово. Осталось вручную:
1. DaVinci Resolve Studio: Preferences -> General -> External scripting using -> Local. Resolve держи открытым.
2. Запусти Claude Code в этой папке:  claude
3. Внутри набери /mcp -> higgsfield -> Authenticate (войти в Higgsfield).
   /mcp должен показать higgsfield и davinci-resolve как connected.
Потом:  /sfx

Управлять с iPhone: вместо "claude" запусти "claude remote-control" (см. IPHONE.md).
MSG
