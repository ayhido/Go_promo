#!/usr/bin/env bash
# Двойной клик в Finder: раскладывает SFX по маркерам активного таймлайна Resolve.
cd "$(dirname "$0")"
PY="/Library/Frameworks/Python.framework/Versions/3.12/bin/python3"
[ -x "$PY" ] || PY="$(command -v python3)"
"$PY" sfx_markers.py
echo; read -n 1 -s -r -p "Нажмите любую клавишу, чтобы закрыть"
