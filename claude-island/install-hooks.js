#!/usr/bin/env node
// Подключить/отключить плашку к Claude Code из командной строки:
//   npm run install-hooks      npm run uninstall-hooks
// (В установленном приложении то же самое делается из меню в трее.)
const path = require('path');
const hooks = require('./hooks-config');

try {
  if (process.argv.includes('--uninstall')) {
    console.log('Хуки плашки удалены из ' + hooks.uninstall());
  } else {
    const file = hooks.install(path.join(__dirname, 'hook.js'));
    console.log(`Хуки установлены в ${file}\nПерезапустите Claude Code, чтобы он их подхватил.`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
