const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('note', {
  onData: (cb) => ipcRenderer.on('note:data', (_e, data) => cb(data)),
  open: () => ipcRenderer.send('note:open'),
  close: () => ipcRenderer.send('note:close'),
  expand: (expanded) => ipcRenderer.send('note:expand', expanded),
  reply: (text) => ipcRenderer.invoke('note:reply', text)
});
