// Окно-«чёлка» поверх всех окон + локальный приёмник событий от хуков Claude Code.
const { app, BrowserWindow, screen } = require('electron');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.CLAUDE_ISLAND_PORT) || 47321;
const WIDTH = 580;
const HEIGHT = 230;

let win = null;
const queue = []; // события, пришедшие до загрузки окна

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// --debug: обычное видимое окно с рамкой и инструментами разработчика.
const DEBUG = process.argv.includes('--debug');
const log = (...a) => console.log('[claude-island]', ...a);

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
  // Всё, что происходит внутри окна, — в консоль PowerShell.
  wc.on('console-message', (e) => log('окно:', e.message));
  wc.on('preload-error', (_e, p, err) => log('ошибка preload:', p, err && err.message));
  wc.on('did-fail-load', (_e, code, desc, url) => log('страница не загрузилась:', code, desc, url));
  wc.on('did-finish-load', () => {
    log('страница плашки загружена');
    while (queue.length) wc.send('claude-event', queue.shift());
  });

  win.once('ready-to-show', () => {
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true);
    // Плашка не мешает кликать по тому, что под ней.
    if (!DEBUG) win.setIgnoreMouseEvents(true, { forward: true });
    log('окно показано, координаты:', JSON.stringify(win.getBounds()));
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
  if (!win) log('окна нет — событие отложено');
  if (win && !win.webContents.isLoading()) win.webContents.send('claude-event', evt);
  else queue.push(evt);
}

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('ok');
    }
    // Проверка без Claude Code: открыть в браузере http://127.0.0.1:47321/test
    if (req.method === 'GET' && req.url === '/test') {
      console.log('[claude-island] запускаю проверочный показ');
      deliver({ event: '__demo' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta charset="utf-8"><body style="font:16px system-ui;padding:24px">Плашка работает — смотрите вверх экрана. Окно можно закрыть.</body>');
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
        console.log(`[claude-island] событие: ${evt.event}${evt.tool ? ' · ' + evt.tool : ''}`);
        deliver(evt);
        res.writeHead(204);
      } catch {
        res.writeHead(400);
      }
      res.end();
    });
  });
  server.on('error', (err) => {
    console.error(`[claude-island] порт ${PORT} недоступен:`, err.message);
  });
  // Только localhost — снаружи к плашке не достучаться.
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[claude-island] жду события на http://127.0.0.1:${PORT}/event`);
  });
}

// Прозрачные окна на части видеокарт Windows падают или чернеют — рисуем программно.
app.disableHardwareAcceleration();

process.on('uncaughtException', (err) => console.error('[claude-island] ошибка:', err));

app.whenReady().then(() => {
  createWindow();
  startServer();
});

// Если окно плашки упало или закрылось — поднимаем его заново, а не выходим.
app.on('render-process-gone', (_e, _wc, details) => {
  console.error('[claude-island] окно упало:', details.reason, '— перезапускаю');
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
  setTimeout(createWindow, 500);
});
app.on('child-process-gone', (_e, details) => {
  console.error('[claude-island] процесс', details.type, 'завершился:', details.reason);
});
app.on('window-all-closed', () => {
  console.log('[claude-island] окно закрыто — открываю снова');
  setTimeout(() => { if (!win) createWindow(); }, 500);
});
app.on('will-quit', () => console.log('[claude-island] программа завершается'));
