#!/usr/bin/env bash
# SFX Studio — установка всего одной командой (macOS). В Терминале:
#   curl -fsSL https://raw.githubusercontent.com/ayhido/Go_promo/main/sfx-studio/install.sh | bash
# Ставит: Python 3.12 (python.org), Claude Code, проект в ~/sfx-studio, Resolve MCP.
# DaVinci Resolve Studio (платный) нужно установить самому.
set -euo pipefail
REPO="ayhido/Go_promo"
BRANCHES="main claude/festive-ptolemy-s9g9hp"
DEST="$HOME/sfx-studio"
PY_VER="3.12.10"

[ "$(uname -s)" = "Darwin" ] || { echo "Этот установщик для macOS. Windows: install.ps1"; exit 1; }

echo "== 1/5 Git (Command Line Tools)"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  echo "Нажмите «Установить» в появившемся окне, дождитесь окончания и запустите эту команду снова."
  exit 0
fi

echo "== 2/5 Python $PY_VER с python.org (Resolve видит именно его)"
PYBIN="/Library/Frameworks/Python.framework/Versions/3.12/bin/python3"
if [ ! -x "$PYBIN" ]; then
  PKG="$(mktemp -d)/python.pkg"
  curl -fL "https://www.python.org/ftp/python/$PY_VER/python-$PY_VER-macos11.pkg" -o "$PKG"
  echo "Нужен пароль администратора Mac для установки Python:"
  sudo installer -pkg "$PKG" -target /
fi
export PATH="/Library/Frameworks/Python.framework/Versions/3.12/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

echo "== 3/5 Claude Code"
command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash
for rc in "$HOME/.zshrc" "$HOME/.bash_profile"; do
  grep -qs '.local/bin' "$rc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
done

echo "== 4/5 Скачиваю проект в $DEST"
TMP="$(mktemp -d)"; SRC=""
for b in $BRANCHES; do
  d="$TMP/${b//\//_}"; mkdir -p "$d"
  if curl -fsSL "https://github.com/$REPO/archive/refs/heads/$b.zip" -o "$d/src.zip" && unzip -q "$d/src.zip" -d "$d"; then
    c="$(find "$d" -maxdepth 3 -path '*/sfx-studio/setup.sh' | head -1)"
    [ -n "$c" ] && { SRC="$(dirname "$c")"; break; }
  fi
done
[ -n "$SRC" ] || { echo "Не удалось скачать проект с GitHub."; exit 1; }
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
chmod +x "$DEST/setup.sh"
rm -rf "$TMP"

echo "== 5/5 Resolve MCP"
"$DEST/setup.sh"

if [ ! -d "/Applications/DaVinci Resolve" ] && [ ! -d "/Applications/DaVinci Resolve Studio.app" ]; then
  echo; echo "DaVinci Resolve не найден. Установите DaVinci Resolve Studio: https://www.blackmagicdesign.com/products/davinciresolve"
fi
echo; echo "Дальше: откройте НОВОЕ окно Терминала и выполните:"; echo "  cd ~/sfx-studio && claude"
