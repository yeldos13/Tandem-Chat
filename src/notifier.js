const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

const WIDTH = 360;
const HEIGHT = 92;
const EXPANDED = 152;
const GAP = 8;
const MAX = 3;

class Notifier {
  constructor({ onOpen, onReply, getTheme, getLabels }) {
    this.onOpen = onOpen;
    this.onReply = onReply;
    this.getTheme = getTheme;
    this.getLabels = getLabels;
    this.items = [];
    this.seq = 0;

    const find = (e) => this.items.find((i) => !i.win.isDestroyed() && i.win.webContents === e.sender);
    ipcMain.on('note:open', (e) => {
      const item = find(e);
      if (!item) return;
      this.close(item);
      this.onOpen(item.note);
    });
    ipcMain.handle('note:reply', async (e, text) => {
      const item = find(e);
      if (!item || typeof text !== 'string' || !text.trim()) return { ok: false };
      const res = await this.onReply(item.note, text.trim());
      if (res.ok) this.close(item);
      return res;
    });
    ipcMain.on('note:close', (e) => {
      const item = find(e);
      if (item) this.close(item);
    });
    ipcMain.on('note:expand', (e, expanded) => {
      const item = find(e);
      if (!item) return;
      item.expanded = !!expanded;
      if (expanded) item.win.focus();
      this.layout();
    });
  }

  show(note) {
    while (this.items.length >= MAX) this.close(this.items[0]);
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      backgroundColor: this.getTheme().background,
      webPreferences: {
        preload: path.join(__dirname, 'notify', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    const item = { key: ++this.seq, win, note, expanded: false };
    this.items.push(item);
    win.loadFile(path.join(__dirname, 'notify', 'index.html'));
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return;
      win.webContents.send('note:data', { ...note, theme: this.getTheme().name, labels: this.getLabels() });
      this.layout();
      win.showInactive();
    });
    win.on('closed', () => {
      this.items = this.items.filter((i) => i !== item);
      this.layout();
    });
  }

  close(item) {
    if (!item.win.isDestroyed()) item.win.destroy();
    this.items = this.items.filter((i) => i !== item);
    this.layout();
  }

  closeAll() {
    for (const item of [...this.items]) this.close(item);
  }

  layout() {
    const area = screen.getPrimaryDisplay().workArea;
    let bottom = area.y + area.height - GAP;
    for (const item of [...this.items].reverse()) {
      if (item.win.isDestroyed()) continue;
      const height = item.expanded ? EXPANDED : HEIGHT;
      item.win.setBounds({ x: area.x + area.width - WIDTH - GAP, y: bottom - height, width: WIDTH, height });
      bottom -= height + GAP;
    }
  }
}

module.exports = Notifier;
