# SFX Studio (Claude Code + Higgsfield MCP + DaVinci Resolve)

## Требования
macOS, DaVinci Resolve **Studio** 18+, Python 3.10+, git, Claude Code, платный аккаунт Higgsfield.

## Запуск
```
cd sfx-studio
./setup.sh
claude
/mcp          # авторизуй higgsfield, проверь что davinci-resolve connected
/sfx кинематографичный стиль
```

## Структура
- `.mcp.json` — подключение двух MCP-серверов
- `CLAUDE.md` — правила работы
- `.claude/commands/sfx.md` — команда /sfx
- `setup.sh` — установка Resolve MCP (community-проект samuelgursky/davinci-resolve-mcp)

Не проверено на реальной машине: пути Resolve для macOS стандартные, но если у вас нестандартная установка — поправьте env в `.mcp.json`.
