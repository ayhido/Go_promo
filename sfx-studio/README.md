# SFX Studio (Claude Code + Higgsfield MCP + DaVinci Resolve)

Автоматический саунд-дизайн: Claude смотрит таймлайн DaVinci Resolve, предлагает список звуков, генерирует их в Higgsfield и раскладывает на новые аудиодорожки.

## Требования
- DaVinci Resolve **Studio** 18+ (в бесплатной версии внешние скрипты ограничены)
- Python 3.10–3.12 (64-бит), git, [Claude Code](https://claude.com/claude-code)
- Платный аккаунт Higgsfield

## Запуск на Mac (или Linux)
```
cd sfx-studio
./setup.sh
claude
/mcp          # higgsfield → Authenticate; davinci-resolve должен быть connected
/sfx кинематографичный стиль
```
На Mac берите Python с python.org: Homebrew-версии Resolve часто не видит.

## Запуск на Windows (ПК)
В PowerShell:
```
cd sfx-studio
powershell -ExecutionPolicy Bypass -File .\setup.ps1
claude
/mcp
/sfx кинематографичный стиль
```
Python ставьте с python.org (64-бит, галочка «Add to PATH»).

## С iPhone
См. [IPHONE.md](IPHONE.md): компьютер работает, а вы управляете из приложения Claude (`claude remote-control`), или упрощённый вариант только на телефоне.

## Перед первым запуском в Resolve
Preferences → General → **External scripting using → Local**, Resolve держите открытым.

## Структура
- `setup.sh` / `setup.ps1` — ставят Resolve MCP ([samuelgursky/davinci-resolve-mcp](https://github.com/samuelgursky/davinci-resolve-mcp)) и создают `.mcp.json` с путями под вашу ОС
- `CLAUDE.md` — правила работы
- `.claude/commands/sfx.md` — команда `/sfx`
- `IPHONE.md` — управление с телефона

`.mcp.json` создаётся установщиком и не хранится в git. Если Resolve установлен в нестандартное место, поправьте `RESOLVE_SCRIPT_LIB` в нём.

Не проверено на реальной машине: пути Resolve стандартные, взяты из документации Resolve MCP.
