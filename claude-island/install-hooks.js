#!/usr/bin/env node
// Добавляет (или убирает с --uninstall) хуки плашки в ~/.claude/settings.json.
// Перед изменением делает резервную копию. Чужие хуки не трогает.
const fs = require('fs');
const os = require('os');
const path = require('path');

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const hookPath = path.join(__dirname, 'hook.js').replace(/\\/g, '/');
const command = `node "${hookPath}"`;
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop', 'SessionEnd'];
const uninstall = process.argv.includes('--uninstall');

const isOurs = (h) => h && typeof h.command === 'string' && h.command.includes('claude-island') && h.command.includes('hook.js');

let settings = {};
if (fs.existsSync(settingsPath)) {
  const text = fs.readFileSync(settingsPath, 'utf8');
  try {
    settings = text.trim() ? JSON.parse(text) : {};
  } catch (e) {
    console.error(`Не удалось прочитать ${settingsPath}: ${e.message}\nИсправьте JSON и запустите ещё раз.`);
    process.exit(1);
  }
  const backup = `${settingsPath}.bak-${Date.now()}`;
  fs.copyFileSync(settingsPath, backup);
  console.log(`Резервная копия: ${backup}`);
} else {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
}

settings.hooks = settings.hooks || {};

for (const event of EVENTS) {
  const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  // Сначала убираем наши старые записи (на случай переустановки из другой папки).
  const cleaned = groups
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length > 0);

  if (!uninstall) {
    const group = { hooks: [{ type: 'command', command, timeout: 5 }] };
    if (event === 'PreToolUse') group.matcher = '*';
    cleaned.push(group);
  }

  if (cleaned.length) settings.hooks[event] = cleaned;
  else delete settings.hooks[event];
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log(uninstall
  ? 'Хуки плашки удалены из ' + settingsPath
  : `Хуки установлены в ${settingsPath}\nКоманда: ${command}\nПерезапустите Claude Code, чтобы он их подхватил.`);
