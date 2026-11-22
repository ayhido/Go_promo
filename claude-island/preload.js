const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeIsland', {
  onEvent: (cb) => ipcRenderer.on('claude-event', (_e, data) => cb(data)),
});
