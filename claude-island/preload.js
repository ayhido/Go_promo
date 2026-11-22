const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('island', {
  onEvent: (cb) => ipcRenderer.on('claude-event', (_e, data) => cb(data)),
});
