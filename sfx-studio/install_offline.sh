#!/usr/bin/env bash
# SFX Studio без Claude - установка одной командой (macOS). В Терминале:
#   curl -fsSL https://raw.githubusercontent.com/ayhido/Go_promo/main/sfx-studio/install_offline.sh | bash
# Ставит Python 3.12 (python.org), создает ~/Documents/Mentol/{Chorts,Mem,музыка},
# скачивает скрипты в ~/sfx-studio. Claude Code не нужен. DaVinci Resolve Studio установите сами.
set -euo pipefail
REPO="ayhido/Go_promo"
BRANCHES="main claude/festive-ptolemy-s9g9hp"
DEST="$HOME/sfx-studio"
PY_VER="3.12.10"
PYBIN="/Library/Frameworks/Python.framework/Versions/3.12/bin/python3"

[ "$(uname -s)" = "Darwin" ] || { echo "Этот установщик для macOS"; exit 1; }

echo "== 1/3 Python $PY_VER"
if [ ! -x "$PYBIN" ]; then
  PKG="$(mktemp -d)/python.pkg"
  curl -fL "https://www.python.org/ftp/python/$PY_VER/python-$PY_VER-macos11.pkg" -o "$PKG"
  echo "Введите пароль от Mac (символы не отображаются) и нажмите Enter:"
  sudo installer -pkg "$PKG" -target /
fi

echo "== 2/3 Папки Mentol"
MENTOL="$HOME/Documents/Mentol"
mkdir -p "$MENTOL/Chorts" "$MENTOL/Mem" "$MENTOL/музыка"
echo "   $MENTOL"

echo "== 3/3 Скрипты в $DEST"
TMP="$(mktemp -d)"; SRC=""
for b in $BRANCHES; do
  d="$TMP/${b//\//_}"; mkdir -p "$d"
  if curl -fsSL "https://github.com/$REPO/archive/refs/heads/$b.zip" -o "$d/src.zip" && unzip -q "$d/src.zip" -d "$d"; then
    c="$(find "$d" -maxdepth 3 -path '*/sfx-studio/sfx_markers.py' | head -1)"
    [ -n "$c" ] && { SRC="$(dirname "$c")"; break; }
  fi
done
[ -n "$SRC" ] || { echo "Не удалось скачать скрипты с GitHub."; exit 1; }
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
rm -rf "$TMP"
chmod +x "$DEST"/*.command "$DEST"/*.sh 2>/dev/null || true

if [ ! -d "/Applications/DaVinci Resolve" ] && [ ! -d "/Applications/DaVinci Resolve Studio.app" ]; then
  echo; echo "DaVinci Resolve не найден: https://www.blackmagicdesign.com/products/davinciresolve"
fi
cat <<MSG

Готово.
1. Звуки кладите в: $MENTOL/музыка  (whoosh_01.wav, удар_1.wav ... или подпапки whoosh/, удар/)
2. В Resolve: DaVinci Resolve -> Settings/Preferences -> General -> External scripting using -> Local
3. На таймлайне ставьте маркеры (M), в имени маркера - тип звука: whoosh, удар ...
4. Запуск: двойной клик по ~/sfx-studio/run_markers.command
MSG
open "$MENTOL"
