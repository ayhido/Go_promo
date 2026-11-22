// Claude Island — плашка-«чёлка» для Claude Code.
// Главный процесс: окно поверх всех окон, значок в трее, приёмник событий от хуков.
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, screen, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const hooks = require('./hooks-config');

const PORT = Number(process.env.CLAUDE_ISLAND_PORT) || 47321;
const WIDTH = 580;
const HEIGHT = 230;
const DEBUG = process.argv.includes('--debug');
const HOOK_TARGET = path.join(os.homedir(), '.claude', 'claude-island-hook.js');

app.setAppUserModelId('local.claude-island');

let win = null;
let tray = null;
let quitting = false;
const queue = []; // события, пришедшие до загрузки окна

// ───────────── журнал (в консоль и в файл) ─────────────
let logFile = null;
function log(...args) {
  const line = `[${new Date().toLocaleTimeString('ru-RU')}] ${args.join(' ')}`;
  console.log('[claude-island]', ...args);
  try {
    if (!logFile) {
      logFile = path.join(app.getPath('userData'), 'claude-island.log');
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1e6) fs.unlinkSync(logFile);
    }
    fs.appendFileSync(logFile, line + '\n');
  } catch { /* журнал не критичен */ }
}

// ───────────── настройки ─────────────
const configPath = () => path.join(app.getPath('userData'), 'config.json');
let config = { firstRunDone: false, paused: false };
function loadConfig() {
  try { config = { ...config, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) }; } catch { /* первый запуск */ }
}
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch (e) { log('не удалось сохранить настройки:', e.message); }
}

// ───────────── хуки Claude Code ─────────────
// Кладём хук рядом с настройками Claude Code: оттуда его запускает обычный node,
// а внутри установленного приложения (asar) файл ему был бы недоступен.
function deployHookFile() {
  try {
    fs.mkdirSync(path.dirname(HOOK_TARGET), { recursive: true });
    const src = fs.readFileSync(path.join(__dirname, 'hook.js'), 'utf8');
    const cur = fs.existsSync(HOOK_TARGET) ? fs.readFileSync(HOOK_TARGET, 'utf8') : '';
    if (cur !== src) fs.writeFileSync(HOOK_TARGET, src);
    return true;
  } catch (e) {
    log('не удалось записать хук:', e.message);
    return false;
  }
}

function nodeAvailable() {
  try {
    const r = spawnSync('node -v', { shell: true, windowsHide: true, timeout: 5000, encoding: 'utf8' });
    return r.status === 0;
  } catch { return false; }
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
  } catch { /* не важно */ }
}

function connectHooks({ quiet = false } = {}) {
  try {
    if (!deployHookFile()) throw new Error('не удалось записать файл хука');
    hooks.install(HOOK_TARGET);
    log('хуки установлены →', HOOK_TARGET);
    if (!quiet) notify('Подключено к Claude Code', 'Перезапустите Claude Code, чтобы плашка заработала.');
  } catch (e) {
    log('ошибка подключения:', e.message);
    notify('Не удалось подключиться к Claude Code', e.message);
  }
  refreshTray();
}

function disconnectHooks() {
  try {
    hooks.uninstall();
    log('хуки удалены');
    notify('Отключено от Claude Code', 'Плашка больше не будет получать события.');
  } catch (e) {
    notify('Не удалось отключить', e.message);
  }
  refreshTray();
}

// ───────────── автозапуск ─────────────
function loginItemOptions() {
  // В режиме разработки запускаем electron.exe с путём к проекту.
  return app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
}
const isAutostart = () => app.getLoginItemSettings(loginItemOptions()).openAtLogin;
function setAutostart(on) {
  app.setLoginItemSettings({ openAtLogin: on, ...loginItemOptions() });
  refreshTray();
}

// ───────────── окно плашки ─────────────
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT + (DEBUG ? 40 : 0),
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: workArea.y + (DEBUG ? 60 : 6),
    show: false,
    frame: DEBUG,
    transparent: !DEBUG,
    resizable: DEBUG,
    movable: DEBUG,
    alwaysOnTop: true,
    skipTaskbar: !DEBUG,
    focusable: DEBUG,
    hasShadow: false,
    backgroundColor: DEBUG ? '#1e3a8a' : '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const wc = win.webContents;
  wc.on('console-message', (e) => log('окно:', e.message));
  wc.on('preload-error', (_e, p, err) => log('ошибка preload:', p, err && err.message));
  wc.on('did-fail-load', (_e, code, desc) => log('страница не загрузилась:', code, desc));
  wc.on('did-finish-load', () => {
    while (queue.length) wc.send('claude-event', queue.shift());
  });

  win.once('ready-to-show', () => {
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true);
    // Плашка не мешает кликать по тому, что под ней.
    if (!DEBUG) win.setIgnoreMouseEvents(true, { forward: true });
  });

  const query = {};
  if (process.argv.includes('--demo')) query.demo = '1';
  if (DEBUG) query.debug = '1';
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query })
    .catch((err) => log('loadFile ошибка:', err.message));
  if (DEBUG) wc.openDevTools({ mode: 'detach' });

  win.on('closed', () => { win = null; });
}

function deliver(evt) {
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('claude-event', evt);
  else queue.push(evt);
}

const runDemo = () => deliver({ event: '__demo' });

// ───────────── значок в трее ─────────────
function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16, quality: 'best' });
}

function refreshTray() {
  if (!tray) return;
  const connected = hooks.isInstalled();
  tray.setToolTip(
    config.paused ? 'Claude Island — на паузе'
      : connected ? 'Claude Island — работает'
        : 'Claude Island — не подключено к Claude Code',
  );
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: connected ? '✓ Подключено к Claude Code' : '⚠ Не подключено к Claude Code', enabled: false },
    { type: 'separator' },
    { label: 'Показать проверку', click: runDemo },
    {
      label: 'Пауза (не показывать плашку)', type: 'checkbox', checked: config.paused,
      click: (item) => { config.paused = item.checked; saveConfig(); refreshTray(); },
    },
    { label: 'Запускать вместе с Windows', type: 'checkbox', checked: isAutostart(), click: (item) => setAutostart(item.checked) },
    { type: 'separator' },
    connected
      ? { label: 'Отключить от Claude Code', click: disconnectHooks }
      : { label: 'Подключить к Claude Code', click: () => connectHooks() },
    { label: 'Открыть журнал', click: () => logFile && shell.openPath(logFile) },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.on('click', runDemo);
  refreshTray();
}

// ───────────── приём событий ─────────────
function startServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('ok');
    }
    // Проверка без Claude Code: http://127.0.0.1:47321/test
    if (req.method === 'GET' && req.url === '/test') {
      runDemo();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta charset="utf-8"><body style="font:16px system-ui;padding:24px">Плашка работает — смотрите вверх экрана.</body>');
    }
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404);
      return res.end();
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        const evt = JSON.parse(body);
        if (DEBUG) log(`событие: ${evt.event}${evt.tool ? ' · ' + evt.tool : ''}`);
        if (!config.paused) deliver(evt);
        res.writeHead(204);
      } catch {
        res.writeHead(400);
      }
      res.end();
    });
  });
  server.on('error', (err) => {
    log(`порт ${PORT} недоступен:`, err.message);
    notify('Claude Island не запустилась', `Порт ${PORT} занят: ${err.message}`);
  });
  // Только localhost — снаружи к плашке не достучаться.
  server.listen(PORT, '127.0.0.1', () => log(`жду события на http://127.0.0.1:${PORT}/event`));
}

// ───────────── запуск ─────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Повторный запуск (ярлык, автозапуск) — просто показываем, что всё работает.
  app.on('second-instance', runDemo);

  // Прозрачные окна на части видеокарт Windows падают или чернеют — рисуем программно.
  app.disableHardwareAcceleration();
  process.on('uncaughtException', (err) => log('ошибка:', err && err.stack || err));

  app.whenReady().then(() => {
    loadConfig();
    createWindow();
    startServer();
    createTray();

    if (fs.existsSync(HOOK_TARGET)) deployHookFile(); // обновить хук после обновления приложения

    if (!config.firstRunDone) {
      // Первый запуск: подключаемся к Claude Code и включаем автозапуск.
      config.firstRunDone = true;
      saveConfig();
      if (app.isPackaged) setAutostart(true);
      connectHooks({ quiet: true });
      const nodeOk = nodeAvailable();
      notify(
        'Claude Island запущена',
        nodeOk
          ? 'Значок в трее. Перезапустите Claude Code — и плашка начнёт показывать его работу.'
          : 'Не найден Node.js — он нужен для связи с Claude Code. Установите с nodejs.org.',
      );
      setTimeout(runDemo, 1200);
    }
    log('запущено', app.getVersion(), app.isPackaged ? '(установлено)' : '(из исходников)');
  });

  // Окно упало — поднимаем заново, а не выходим.
  app.on('render-process-gone', (_e, _wc, details) => {
    log('окно упало:', details.reason, '— перезапускаю');
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    setTimeout(() => { if (!win) createWindow(); }, 500);
  });
  app.on('window-all-closed', () => {
    if (quitting) return app.quit();
    setTimeout(() => { if (!win) createWindow(); }, 500);
  });
  app.on('before-quit', () => { quitting = true; });
}
