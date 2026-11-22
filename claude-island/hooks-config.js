// Работа с хуками в ~/.claude/settings.json: установить, убрать, проверить.
// Используется и приложением (меню в трее), и командой `npm run install-hooks`.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop', 'SessionEnd'];

const isOurs = (h) =>
  h && typeof h.command === 'string' &&
  (h.command.includes('claude-island-hook.js') ||
    (h.command.includes('claude-island') && h.command.includes('hook.js')));

function read() {
  if (!fs.existsSync(SETTINGS)) return {};
  const text = fs.readFileSync(SETTINGS, 'utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Не удалось прочитать ${SETTINGS}: ${e.message}`);
  }
}

function write(settings) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  if (fs.existsSync(SETTINGS)) {
    // одна резервная копия на день, чтобы не плодить файлы
    const day = new Date().toISOString().slice(0, 10);
    const backup = `${SETTINGS}.bak-claude-island-${day}`;
    if (!fs.existsSync(backup)) fs.copyFileSync(SETTINGS, backup);
  }
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
}

/** Ставит хуки, указывающие на hookPath. Старые наши записи заменяются, чужие не трогаются. */
function install(hookPath) {
  return apply(`node "${hookPath.replace(/\\/g, '/')}"`);
}

function uninstall() {
  return apply(null);
}

function apply(command) {
  const settings = read();
  settings.hooks = settings.hooks || {};
  for (const event of EVENTS) {
    const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const cleaned = groups
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (command) {
      const group = { hooks: [{ type: 'command', command, timeout: 5 }] };
      if (event === 'PreToolUse') group.matcher = '*';
      cleaned.push(group);
    }
    if (cleaned.length) settings.hooks[event] = cleaned;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  write(settings);
  return SETTINGS;
}

/** Установлены ли наши хуки (хотя бы на Stop и PreToolUse). */
function isInstalled() {
  try {
    const hooks = read().hooks || {};
    return ['Stop', 'PreToolUse'].every((ev) =>
      (hooks[ev] || []).some((g) => (g.hooks || []).some(isOurs)));
  } catch {
    return false;
  }
}

module.exports = { install, uninstall, isInstalled, SETTINGS };
