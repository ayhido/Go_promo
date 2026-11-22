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

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: workArea.y + 6,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  // Плашка не мешает кликать по тому, что под ней.
  win.setIgnoreMouseEvents(true, { forward: true });

  const query = process.argv.includes('--demo') ? { demo: '1' } : {};
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query });

  win.webContents.on('did-finish-load', () => {
    while (queue.length) win.webContents.send('claude-event', queue.shift());
  });
  win.on('closed', () => { win = null; });
}

function deliver(evt) {
  if (win && !win.webContents.isLoading()) win.webContents.send('claude-event', evt);
  else queue.push(evt);
}

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
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
        deliver(JSON.parse(body));
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

app.whenReady().then(() => {
  createWindow();
  startServer();
});

app.on('window-all-closed', () => app.quit());
