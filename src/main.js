const { app, BaseWindow, WebContentsView, Tray, Menu, nativeImage, shell, session, ipcMain, powerMonitor, globalShortcut, nativeTheme, dialog, Notification, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const Notifier = require('./notifier');
const i18n = require('./i18n');

const WA_URL = 'https://web.whatsapp.com/';
const RAIL_WIDTH = 72;
const COMPACT_WIDTH = 640;
const TITLE_HEIGHT = 32;
const TITLEBAR = {
  'blue-dark': { color: '#17212b', symbolColor: '#8596a8' },
  'blue-light': { color: '#ffffff', symbolColor: '#707579' },
  'green-dark': { color: '#16231f', symbolColor: '#86a397' },
  'green-light': { color: '#ffffff', symbolColor: '#667781' },
  original: { color: '#202c33', symbolColor: '#aebac1' }
};
const THEMES = {
  'blue-dark': 'Синяя — ночная',
  'blue-light': 'Синяя — светлая',
  'green-dark': 'Зелёная — ночная',
  'green-light': 'Зелёная — светлая',
  original: 'Оригинальная WhatsApp'
};
const BACKGROUNDS = {
  'blue-dark': '#0e1621',
  'blue-light': '#ffffff',
  'green-dark': '#0f1a17',
  'green-light': '#ffffff',
  original: '#111b21'
};

function migrateUserData() {
  if (app.commandLine.hasSwitch('user-data-dir')) return app.setPath('userData', path.resolve(app.commandLine.getSwitchValue('user-data-dir')));
  app.setPath('userData', path.join(app.getPath('appData'), 'Tandem Chat'));
}

app.setName('Tandem Chat');
migrateUserData();

function applyInstallLanguage() {
  if (!app.isPackaged) return;
  let chosen = '';
  try {
    chosen = fs.readFileSync(path.join(path.dirname(process.execPath), 'install-language'), 'utf8').trim();
  } catch {
    return;
  }
  if (chosen !== 'ru' && chosen !== 'en') return;
  const saved = store.load();
  if (saved.installLanguage === chosen) return;
  saved.installLanguage = chosen;
  saved.uiLanguage = chosen;
  saved.language = 'app';
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
  } catch {}
  store.save(saved);
}

applyInstallLanguage();
const startupLanguage = store.load().uiLanguage === 'en' ? 'en' : 'ru';
app.commandLine.appendSwitch('lang', startupLanguage === 'en' ? 'en-US' : 'ru');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const ALLOWED_PERMISSIONS = new Set(['notifications', 'media', 'mediaKeySystem', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write', 'display-capture']);

let settings;
let win = null;
let shellView = null;
let tray = null;
let quitting = false;
let locked = false;
let overlay = false;
let compact = false;
let failedAttempts = 0;
let lockoutUntil = 0;
const views = new Map();
const pending = new Map();
let notifier = null;
let requestSeq = 0;

const asset = (...p) => path.join(__dirname, '..', 'assets', ...p);
const lang = () => (settings && settings.uiLanguage === 'en' ? 'en' : 'ru');
const tr = (text) => i18n.translate(lang(), text);
const i18nPayload = () => ({ lang: lang(), EN: lang() === 'en' ? i18n.EN : {}, PATTERNS: lang() === 'en' ? i18n.PATTERNS : [] });
const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_FILE;
const readTheme = (name) => fs.readFileSync(path.join(__dirname, 'themes', `${name}.css`), 'utf8');
const activeView = () => views.get(settings.activeId);

function chromeUserAgent() {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
}

function publicState() {
  return {
    accounts: settings.accounts.map((a) => {
      const v = views.get(a.id);
      return { id: a.id, name: tr(a.name), color: a.color, muted: !!a.muted, sound: a.sound || 'note', unread: v ? v.unread : 0, section: v ? v.section : 0, avatar: v ? v.avatar : null, loggedIn: v ? v.loggedIn : false, unseenStatus: v ? v.unseenStatus : 0 };
    }),
    hideFilters: !!settings.hideFilters,
    notifyStyle: settings.notifyStyle,
    language: settings.language,
    uiLanguage: lang(),
    badgeStyle: settings.badgeStyle,
    startHidden: !!settings.startHidden,
    handleLinks: !!settings.handleLinks,
    spellcheck: !!settings.spellcheck,
    downloads: { mode: settings.downloads.mode, folder: downloadDir(), notify: !!settings.downloads.notify },
    portable: isPortable(),
    dnd: settings.dnd,
    dndActive: dndActive(),
    scheduled: settings.scheduled.map((m) => ({ id: m.id, chatName: m.chatName, text: m.text, at: m.at, account: (settings.accounts.find((a) => a.id === m.accountId) || {}).name || '', error: m.error || null })),
    activeId: settings.activeId,
    compact,
    theme: currentTheme(),
    themeChoice: settings.theme,
    themeMode: settings.themeMode,
    themeSchedule: settings.themeSchedule,
    zoom: settings.zoom,
    density: settings.density,
    blur: !!settings.blur,
    globalHotkey: !!settings.globalHotkey,
    hotkeyOk,
    hideTyping: !!settings.hideTyping,
    favoriteStyle: !!settings.favoriteStyle,
    templates: settings.templates,
    folders: settings.folders,
    lockedChats: settings.lockedChats,
    reminders: settings.reminders.map((r) => ({ id: r.id, chatName: r.chatName, text: r.text, at: r.at })),
    diag: [...views.entries()].map(([id, v]) => ({ id, name: (settings.accounts.find((a) => a.id === id) || {}).name || '', checks: v.diag || null })),
    themes: THEMES,
    locked,
    hasPasscode: !!settings.passcode,
    autoLockMinutes: settings.autoLockMinutes,
    autostart: autostartEnabled(),
    lockoutSeconds: Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000))
  };
}

function pushState() {
  if (shellView) shellView.webContents.send('shell:state', publicState());
  const total = settings.accounts.reduce((sum, a) => sum + ((views.get(a.id) || {}).unread || 0), 0);
  if (win) win.setTitle(total ? `Tandem Chat (${total})` : 'Tandem Chat');
  if (tray) tray.setToolTip(total ? tr(`Tandem Chat — непрочитанных: ${total}`) : 'Tandem Chat');
  for (const v of views.values()) sendUi(v);
}

function minutesOf(value) {
  const [h, m] = String(value || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function dndActive() {
  const dnd = settings.dnd;
  if (!dnd || !dnd.enabled) return false;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const from = minutesOf(dnd.from);
  const to = minutesOf(dnd.to);
  return from <= to ? current >= from && current < to : current >= from || current < to;
}

function accountMuted(id) {
  const account = settings.accounts.find((a) => a.id === id);
  return !!(account && account.muted) || dndActive();
}

function sendUi(v) {
  const entry = [...views.entries()].find(([, value]) => value === v);
  v.view.webContents.send('tandem:ui', {
    locked,
    compact,
    muted: accountMuted(entry ? entry[0] : null),
    notifyStyle: settings.notifyStyle,
    hideFilters: !!settings.hideFilters,
    language: settings.language,
    uiLanguage: lang(),
    theme: currentTheme(),
    blur: !!settings.blur,
    density: settings.density,
    hideTyping: !!settings.hideTyping,
    favoriteStyle: !!settings.favoriteStyle,
    templates: settings.templates,
    folders: settings.folders,
    lockedChats: settings.lockedChats,
    activeId: settings.activeId,
    accounts: settings.accounts.map((a) => ({ id: a.id, name: tr(a.name), color: a.color, unread: (views.get(a.id) || {}).unread || 0 }))
  });
}

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  const nextCompact = width < COMPACT_WIDTH;
  if (nextCompact !== compact) {
    compact = nextCompact;
    pushState();
  }
  const rail = compact ? 0 : RAIL_WIDTH;
  shellView.setBounds({ x: 0, y: 0, width, height });
  for (const [id, v] of views) {
    v.view.setBounds({ x: rail, y: TITLE_HEIGHT, width: Math.max(0, width - rail), height: Math.max(0, height - TITLE_HEIGHT) });
    v.view.setVisible(id === settings.activeId && !locked);
  }
}

function restack() {
  if (!win) return;
  const content = win.contentView;
  for (const v of views.values()) {
    if (!content.children.includes(v.view)) content.addChildView(v.view);
  }
  const active = activeView();
  if (overlay || locked || !active) {
    content.addChildView(shellView);
  } else {
    content.addChildView(active.view);
  }
  layout();
}

function applyTheme(v) {
  v.themeQueue = (v.themeQueue || Promise.resolve()).then(() => insertTheme(v)).catch(() => {});
  return v.themeQueue;
}

const scopedTheme = (name) => `html[data-wg-theme="${name}"] {\n${readTheme(name).replace(/:root,\s*body,\s*body\.dark\s*\{/, '&, & body, & body.dark {')}\n}`;

async function insertTheme(v) {
  const wc = v.view.webContents;
  if (wc.isDestroyed()) return;
  if (!v.baseCss) {
    v.baseCss = true;
    await wc.insertCSS(readTheme('layout'), { cssOrigin: 'user' });
    await wc.insertCSS(readTheme('features'));
  }
  const theme = currentTheme();
  if (theme !== 'original' && !v.themesCss.has(theme)) {
    v.themesCss.add(theme);
    await wc.insertCSS(scopedTheme(theme), { cssOrigin: 'user' });
  }
  await wc.executeJavaScript(`document.documentElement.dataset.wgTheme = ${JSON.stringify(theme)}`).catch(() => {});
}

function sendKey(wc, keyCode, modifiers) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

function handleShortcut(input) {
  if (input.type !== 'keyDown') return false;
  const key = input.key.toLowerCase();
  const ctrl = input.control && !input.alt && !input.meta;
  const alt = input.alt && !input.control && !input.meta;
  const shift = input.shift;
  const v = activeView();
  const wc = v && v.view.webContents;

  if (ctrl && !shift && key === 'q') return quit(), true;
  if (ctrl && !shift && key === 'w') return win.hide(), true;
  if (ctrl && !shift && key === 'l') {
    if (settings.passcode) lock();
    else openModal('passcode');
    return true;
  }
  if (locked || !wc) return false;

  if (ctrl && shift && /^digit[1-9]$/.test(input.code)) {
    const account = settings.accounts[Number(input.code.slice(5)) - 1];
    if (account) activate(account.id);
    return true;
  }
  if (ctrl && !shift && /^digit[1-6]$/.test(input.code)) {
    wc.send('tandem:open-section', Number(input.code.slice(5)) - 1);
    return true;
  }
  if ((ctrl && !shift && key === 'tab') || (alt && !shift && key === 'arrowdown') || (ctrl && !shift && key === 'pagedown')) {
    sendKey(wc, 'Tab', ['control', 'alt']);
    return true;
  }
  if ((ctrl && shift && key === 'tab') || (alt && !shift && key === 'arrowup') || (ctrl && !shift && key === 'pageup')) {
    sendKey(wc, 'Tab', ['control', 'alt', 'shift']);
    return true;
  }
  if (ctrl && !shift && (key === 'f' || key === 'k')) return sendKey(wc, '/', ['control', 'alt']), true;
  if (ctrl && shift && key === 'f') return sendKey(wc, 'F', ['control', 'alt', 'shift']), true;
  if (ctrl && !shift && key === 'n') return sendKey(wc, 'N', ['control', 'alt']), true;
  if (ctrl && !shift && key === ',') return sendKey(wc, ',', ['control', 'alt']), true;
  if (ctrl && !shift && (key === '=' || key === '+')) return setZoom(settings.zoom + 0.1), true;
  if (ctrl && !shift && key === '-') return setZoom(settings.zoom - 0.1), true;
  if (ctrl && !shift && key === '0') return setZoom(1), true;
  if (ctrl && shift && key === 'b') {
    settings.blur = !settings.blur;
    store.save(settings);
    pushState();
    return true;
  }
  if (key === 'f5' || (ctrl && !shift && key === 'r')) return wc.reload(), true;
  if (key === 'f12' || (ctrl && shift && key === 'i')) return wc.toggleDevTools(), true;
  return false;
}

function attachShortcuts(wc) {
  wc.on('before-input-event', (e, input) => {
    if (handleShortcut(input)) e.preventDefault();
  });
}

function setupSession(partition) {
  const ses = session.fromPartition(partition);
  ses.setUserAgent(chromeUserAgent(), startupLanguage === 'en' ? 'en-US,en,ru-RU,ru' : 'ru-RU,ru,en-US,en');
  ses.setSpellCheckerLanguages(['ru', 'en-US']);
  ses.setSpellCheckerEnabled(!!settings.spellcheck);
  if (!ses.__wgDownloads) {
    ses.__wgDownloads = true;
    ses.on('will-download', (_e, item) => handleDownload(item));
  }
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(wc.getURL().startsWith(WA_URL) && ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => origin.startsWith('https://web.whatsapp.com') && ALLOWED_PERMISSIONS.has(permission));
  return ses;
}

function createAccountView(account) {
  setupSession(account.partition);
  const view = new WebContentsView({
    webPreferences: {
      partition: account.partition,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false
    }
  });
  view.setBackgroundColor(BACKGROUNDS[currentTheme()]);
  const v = { view, unread: 0, section: 0, avatar: null, loggedIn: false, unseenStatus: 0, lastProbe: 0, baseCss: false, themesCss: new Set() };
  views.set(account.id, v);
  const wc = view.webContents;

  wc.on('page-title-updated', (_e, title) => {
    const match = title.match(/\((\d+)\)/);
    const unread = match ? Number(match[1]) : 0;
    if (unread > v.unread && win && !win.isFocused() && !accountMuted(account.id)) win.flashFrame(true);
    v.unread = unread;
    pushState();
  });
  wc.setWindowOpenHandler(({ url }) => {
    openOutside(url, account.id);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(WA_URL)) {
      e.preventDefault();
      openOutside(url, account.id);
    }
  });
  wc.on('context-menu', (_e, params) => showContextMenu(wc, params, account.id));
  wc.on('did-finish-load', () => {
    wc.setZoomFactor(settings.zoom);
    v.baseCss = false;
    v.themesCss = new Set();
    applyTheme(v);
    sendUi(v);
    v.lastProbe = 0;
    setTimeout(() => probeStatuses(), 15000);
  });
  wc.on('render-process-gone', () => setTimeout(() => !wc.isDestroyed() && wc.reload(), 1000));
  let retryDelay = 3000;
  wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    setTimeout(() => {
      if (!wc.isDestroyed()) wc.loadURL(WA_URL);
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60000);
  });
  wc.on('did-finish-load', () => {
    if (wc.getURL().startsWith(WA_URL)) retryDelay = 3000;
  });
  attachShortcuts(wc);

  wc.loadURL(WA_URL);
  if (win) restack();
  return v;
}

const INVITE = /^[\w-]{10,40}$/;

function waLinkTarget(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  const send = (phone, text) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits || digits.length > 15) return null;
    const query = new URLSearchParams({ phone: digits });
    if (text) query.set('text', String(text).slice(0, 4000));
    return `${WA_URL}send?${query}`;
  };
  const invite = (code) => (code && INVITE.test(code) ? `${WA_URL}accept?code=${code}` : null);
  if (u.protocol === 'whatsapp:') {
    const action = (u.hostname || u.pathname.replace(/^\/+/, '').split(/[/?]/)[0]).toLowerCase();
    if (action === 'send') return send(u.searchParams.get('phone'), u.searchParams.get('text'));
    if (action === 'chat') return invite(u.searchParams.get('code'));
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'wa.me') {
    const phone = u.pathname.slice(1).replace(/\/$/, '');
    return /^\d+$/.test(phone) ? send(phone, u.searchParams.get('text')) : null;
  }
  if (host === 'api.whatsapp.com' && /^\/send\/?$/.test(u.pathname)) return send(u.searchParams.get('phone'), u.searchParams.get('text'));
  if (host === 'chat.whatsapp.com') return invite(u.pathname.split('/')[1]);
  return null;
}

let pendingLink = null;

function openWaLink(target, accountId) {
  showWindow();
  if (locked) {
    pendingLink = { target, accountId };
    return;
  }
  const id = views.has(accountId) ? accountId : settings.activeId;
  if (overlay) closeModal();
  activate(id);
  const v = views.get(id);
  if (v) v.view.webContents.loadURL(target);
}

function openOutside(url, accountId) {
  const target = waLinkTarget(url);
  if (target) return openWaLink(target, accountId);
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

const linkArg = (argv) => argv.find((a) => /^whatsapp:/i.test(a));

function showContextMenu(wc, p, accountId) {
  const items = [];
  const separate = () => {
    if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
  };
  if (p.isEditable && p.misspelledWord) {
    const suggestions = p.dictionarySuggestions.slice(0, 5);
    for (const word of suggestions) items.push({ label: word, click: () => wc.replaceMisspelling(word) });
    if (!suggestions.length) items.push({ label: tr('Нет вариантов'), enabled: false });
    items.push({ label: tr('Добавить в словарь'), click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    separate();
  }
  if (p.linkURL && /^(https?|whatsapp):/i.test(p.linkURL)) {
    if (waLinkTarget(p.linkURL)) items.push({ label: tr('Открыть в Tandem Chat'), click: () => openOutside(p.linkURL, accountId) });
    if (/^https?:/i.test(p.linkURL)) items.push({ label: tr('Открыть ссылку в браузере'), click: () => shell.openExternal(p.linkURL) });
    items.push({ label: tr('Копировать адрес ссылки'), click: () => clipboard.writeText(p.linkURL) });
    separate();
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push({ label: tr('Копировать картинку'), click: () => wc.copyImageAt(p.x, p.y) });
    items.push({
      label: tr('Сохранить картинку как…'),
      click: () => {
        askNextDownload = Date.now();
        wc.downloadURL(p.srcURL);
      }
    });
    separate();
  }
  const flags = p.editFlags || {};
  if (p.isEditable) {
    items.push(
      { label: tr('Отменить ввод'), enabled: !!flags.canUndo, click: () => wc.undo() },
      { label: tr('Повторить'), enabled: !!flags.canRedo, click: () => wc.redo() },
      { type: 'separator' },
      { label: tr('Вырезать'), enabled: !!flags.canCut, click: () => wc.cut() },
      { label: tr('Копировать'), enabled: !!flags.canCopy, click: () => wc.copy() },
      { label: tr('Вставить'), enabled: !!flags.canPaste, click: () => wc.paste() },
      { type: 'separator' },
      { label: tr('Выделить всё'), enabled: flags.canSelectAll !== false, click: () => wc.selectAll() }
    );
  } else if (p.selectionText && p.selectionText.trim()) {
    items.push({ label: tr('Копировать'), click: () => wc.copy() });
  }
  while (items.length && items[items.length - 1].type === 'separator') items.pop();
  if (!items.length) return;
  Menu.buildFromTemplate(items).popup({ window: win });
}

let askNextDownload = 0;
let askBatch = null;
const activeDownloads = new Set();
const reserved = new Set();
let savedFiles = [];
let savedTimer = null;

function downloadDir() {
  const folder = settings.downloads && settings.downloads.folder;
  return folder && fs.existsSync(folder) ? folder : app.getPath('downloads');
}

function safeName(name) {
  const clean = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, 180);
  return clean || 'file';
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 1; fs.existsSync(candidate) || reserved.has(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  reserved.add(candidate);
  return candidate;
}

function updateProgress() {
  if (!win) return;
  let total = 0;
  let received = 0;
  for (const item of activeDownloads) {
    const size = item.getTotalBytes();
    if (size > 0) {
      total += size;
      received += item.getReceivedBytes();
    }
  }
  if (!activeDownloads.size) win.setProgressBar(-1);
  else win.setProgressBar(total ? received / total : 2, { mode: total ? 'normal' : 'indeterminate' });
}

function reportSaved(file) {
  if (!settings.downloads.notify || !Notification.isSupported()) return;
  savedFiles.push(file);
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    const files = savedFiles;
    savedFiles = [];
    const single = files.length === 1;
    const note = new Notification({
      title: single ? tr('Файл сохранён') : tr(`Сохранено файлов: ${files.length}`),
      body: single ? path.basename(files[0]) : path.dirname(files[0]),
      icon: asset('icon.png'),
      silent: true
    });
    note.on('click', () => (single ? shell.showItemInFolder(files[0]) : shell.openPath(path.dirname(files[0]))));
    note.show();
  }, 1200);
}

async function moveFile(from, to) {
  try {
    await fs.promises.rename(from, to);
  } catch {
    await fs.promises.copyFile(from, to);
    await fs.promises.rm(from, { force: true });
  }
}

function handleDownload(item) {
  const name = safeName(item.getFilename());
  activeDownloads.add(item);
  item.on('updated', updateProgress);
  const single = Date.now() - askNextDownload < 5000;
  if (single) askNextDownload = 0;

  if (!single && settings.downloads.mode !== 'ask') {
    const dir = downloadDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
    const target = uniquePath(dir, name);
    item.setSavePath(target);
    item.once('done', (_e, state) => {
      reserved.delete(target);
      activeDownloads.delete(item);
      updateProgress();
      if (state === 'completed') reportSaved(target);
    });
    updateProgress();
    return;
  }

  const tmpDir = path.join(app.getPath('temp'), 'tandem-chat-downloads');
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch {}
  const tmp = path.join(tmpDir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${name}`);
  item.setSavePath(tmp);
  if (single || !askBatch || askBatch.closed) askBatch = { entries: [], dest: undefined, file: null, closed: false, asking: false, timer: null };
  const batch = askBatch;
  const entry = { item, tmp, name, state: null, placed: false };
  batch.entries.push(entry);
  item.once('done', (_e, state) => {
    entry.state = state;
    activeDownloads.delete(item);
    updateProgress();
    settleBatch(batch);
  });
  updateProgress();
  if (batch.dest !== undefined || batch.asking) return;
  clearTimeout(batch.timer);
  batch.timer = setTimeout(() => askDestination(batch), single ? 0 : 700);
}

async function askDestination(batch) {
  batch.asking = true;
  const last = settings.downloads.lastDir;
  const startDir = last && fs.existsSync(last) ? last : downloadDir();
  let dest = null;
  let file = null;
  if (batch.entries.length === 1) {
    const res = await dialog.showSaveDialog(win, { title: tr('Сохранить файл'), defaultPath: path.join(startDir, batch.entries[0].name) });
    if (!res.canceled && res.filePath) {
      file = res.filePath;
      dest = path.dirname(res.filePath);
    }
  } else {
    const res = await dialog.showOpenDialog(win, {
      title: tr(`Куда сохранить файлы (${batch.entries.length})?`),
      defaultPath: startDir,
      properties: ['openDirectory', 'createDirectory']
    });
    if (!res.canceled && res.filePaths.length) dest = res.filePaths[0];
  }
  batch.asking = false;
  batch.dest = dest;
  batch.file = file;
  if (dest) {
    settings.downloads.lastDir = dest;
    store.save(settings);
    setTimeout(() => (batch.closed = true), 3000);
  } else {
    batch.closed = true;
  }
  settleBatch(batch);
}

function settleBatch(batch) {
  if (batch.dest === undefined) return;
  for (const entry of batch.entries) {
    if (entry.placed) continue;
    if (batch.dest === null) {
      entry.placed = true;
      if (entry.state === null) entry.item.cancel();
      else fs.rm(entry.tmp, { force: true }, () => {});
      continue;
    }
    if (entry.state === null) continue;
    entry.placed = true;
    if (entry.state !== 'completed') {
      fs.rm(entry.tmp, { force: true }, () => {});
      continue;
    }
    const target = batch.file && batch.entries.length === 1 ? batch.file : uniquePath(batch.dest, entry.name);
    moveFile(entry.tmp, target)
      .then(() => reportSaved(target))
      .catch(() => {})
      .finally(() => reserved.delete(target));
  }
}

function requestView(id, type, payload, timeout = 20000) {
  const v = views.get(id);
  if (!v) return Promise.resolve({ ok: false, error: tr('Аккаунт не найден') });
  const rid = ++requestSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(rid);
      resolve({ ok: false, error: tr('WhatsApp не ответил') });
    }, timeout);
    pending.set(rid, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
    v.view.webContents.send('tandem:request', { rid, type, payload });
  });
}

let sending = false;
async function runScheduled() {
  if (sending || !settings.scheduled.length) return;
  sending = true;
  try {
    const now = Date.now();
    for (const item of [...settings.scheduled]) {
      if (item.at > now) continue;
      const v = views.get(item.accountId);
      if (!v || !v.loggedIn) continue;
      const res = await requestView(item.accountId, 'send', { chatId: item.chatId, text: item.text });
      if (res.ok) {
        settings.scheduled = settings.scheduled.filter((m) => m.id !== item.id);
      } else {
        item.error = res.error;
        item.attempts = (item.attempts || 0) + 1;
        item.at = now + Math.min(10, item.attempts) * 60000;
      }
      store.save(settings);
      pushState();
    }
  } finally {
    sending = false;
  }
}

async function runReminders() {
  if (!settings.reminders.length || !notifier) return;
  const now = Date.now();
  const due = settings.reminders.filter((r) => r.at <= now);
  if (!due.length) return;
  settings.reminders = settings.reminders.filter((r) => r.at > now);
  store.save(settings);
  for (const r of due) {
    notifier.show({
      kind: 'reminder',
      accountId: r.accountId,
      chatId: r.chatId,
      title: tr('Напоминание · ' + (r.chatName || tr('чат'))),
      body: r.text || tr('Сообщение'),
      icon: null,
      silent: false,
      sound: soundFor(r.accountId),
      account: '',
      canReply: false
    });
  }
  pushState();
}

function soundFor(accountId) {
  const account = settings.accounts.find((a) => a.id === accountId);
  return (account && account.sound) || 'note';
}

let lastDnd = null;
function tickMinute() {
  refreshTheme();
  const active = dndActive();
  if (active !== lastDnd) {
    lastDnd = active;
    pushState();
  }
}

function themeInfo() {
  return { name: currentTheme(), background: BACKGROUNDS[currentTheme()] };
}

function showNote(accountId, data) {
  const account = settings.accounts.find((a) => a.id === accountId);
  notifier.show({
    accountId,
    id: data.id,
    title: locked ? 'Tandem Chat' : data.title,
    body: locked ? tr('Новое сообщение') : data.body,
    icon: locked ? null : data.icon,
    silent: !!data.silent,
    account: settings.accounts.length > 1 && account ? account.name : '',
    sound: soundFor(accountId),
    canReply: !locked
  });
}

function accountBySender(sender) {
  for (const [id, v] of views) if (v.view.webContents === sender) return { id, v };
  return null;
}

function activate(id) {
  if (!views.has(id)) return;
  settings.activeId = id;
  store.save(settings);
  restack();
  pushState();
  const v = activeView();
  if (!locked && !overlay) v.view.webContents.focus();
}

function openModal(name, data) {
  overlay = true;
  restack();
  shellView.webContents.send('shell:modal', name, data || null);
  shellView.webContents.focus();
}

function closeModal() {
  overlay = false;
  shellView.webContents.send('shell:modal', null);
  restack();
  const v = activeView();
  if (v && !locked) v.view.webContents.focus();
}

function lock() {
  if (!settings.passcode || locked) return;
  locked = true;
  overlay = false;
  restack();
  pushState();
  shellView.webContents.focus();
}

function unlock(code) {
  if (Date.now() < lockoutUntil) return { ok: false, error: tr('Слишком много попыток. Подождите.') };
  if (!store.checkPasscode(settings.passcode, code)) {
    failedAttempts += 1;
    if (failedAttempts >= 5) {
      lockoutUntil = Date.now() + 30000;
      failedAttempts = 0;
      pushState();
      return { ok: false, error: tr('Слишком много попыток. Подождите 30 секунд.') };
    }
    return { ok: false, error: tr('Неверный код-пароль') };
  }
  failedAttempts = 0;
  locked = false;
  restack();
  pushState();
  const v = activeView();
  if (v) v.view.webContents.focus();
  if (pendingLink) {
    const link = pendingLink;
    pendingLink = null;
    openWaLink(link.target, link.accountId);
  }
  return { ok: true };
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.flashFrame(false);
}

function quit() {
  quitting = true;
  app.quit();
}

function rememberBounds() {
  if (!win.isMaximized() && !win.isMinimized()) settings.bounds = win.getBounds();
  settings.maximized = win.isMaximized();
  store.save(settings);
}

function createWindow() {
  win = new BaseWindow({
    ...settings.bounds,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'Tandem Chat',
    icon: asset('icon.ico'),
    backgroundColor: BACKGROUNDS[currentTheme()],
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...TITLEBAR[currentTheme()], height: TITLE_HEIGHT }
  });
  win.setMenuBarVisibility(false);

  shellView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'shell', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  shellView.setBackgroundColor('#00000000');
  win.contentView.addChildView(shellView);
  attachShortcuts(shellView.webContents);
  shellView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  shellView.webContents.on('will-navigate', (e) => e.preventDefault());
  shellView.webContents.loadFile(path.join(__dirname, 'shell', 'index.html'));
  shellView.webContents.once('did-finish-load', () => {
    pushState();
    if (settings.maximized) win.maximize();
    if (!process.argv.includes('--hidden')) win.show();
  });

  for (const account of settings.accounts) createAccountView(account);
  restack();

  win.on('resize', layout);
  win.on('resized', rememberBounds);
  win.on('moved', rememberBounds);
  win.on('maximize', () => (layout(), rememberBounds()));
  win.on('unmaximize', () => (layout(), rememberBounds()));
  win.on('focus', () => {
    win.flashFrame(false);
    const v = activeView();
    if (v && !locked && !overlay) v.view.webContents.focus();
  });
  win.on('blur', () => setTimeout(() => probeStatuses(), 1500));
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function themeFamily() {
  return String(settings.theme).startsWith('green') ? 'green' : 'blue';
}

function isNight() {
  if (settings.themeMode === 'system') return nativeTheme.shouldUseDarkColors;
  if (settings.themeMode === 'schedule') {
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const from = minutesOf(settings.themeSchedule.from);
    const to = minutesOf(settings.themeSchedule.to);
    return from <= to ? current >= from && current < to : current >= from || current < to;
  }
  return null;
}

function currentTheme() {
  const night = isNight();
  if (night === null || settings.theme === 'original') return settings.theme;
  return `${themeFamily()}-${night ? 'dark' : 'light'}`;
}

let appliedTheme = null;
function refreshTheme(force) {
  const theme = currentTheme();
  if (!win || (!force && theme === appliedTheme)) return;
  appliedTheme = theme;
  win.setBackgroundColor(BACKGROUNDS[theme]);
  win.setTitleBarOverlay({ ...TITLEBAR[theme], height: TITLE_HEIGHT });
  for (const v of views.values()) {
    v.view.setBackgroundColor(BACKGROUNDS[theme]);
    applyTheme(v);
  }
  pushState();
}

function setTheme(theme) {
  if (!THEMES[theme]) return;
  settings.theme = theme;
  store.save(settings);
  refreshTheme(true);
}

function setZoom(factor) {
  settings.zoom = Math.min(1.5, Math.max(0.7, Math.round(factor * 100) / 100));
  store.save(settings);
  for (const v of views.values()) v.view.webContents.setZoomFactor(settings.zoom);
  pushState();
}

function toggleWindow() {
  if (win.isVisible() && win.isFocused() && !win.isMinimized()) win.hide();
  else showWindow();
}

let hotkeyOk = true;
function registerGlobalHotkey() {
  globalShortcut.unregisterAll();
  hotkeyOk = true;
  if (settings.globalHotkey) hotkeyOk = globalShortcut.register('CommandOrControl+Shift+W', toggleWindow) && globalShortcut.isRegistered('CommandOrControl+Shift+W');
}

function miniMode() {
  if (win.isMaximized()) win.unmaximize();
  const { x, y } = win.getBounds();
  win.setBounds({ x, y, width: 380, height: 640 });
  showWindow();
}

const devArgs = () => (app.isPackaged ? [] : [path.resolve(app.getAppPath())]);

function loginItemOptions(hidden = !!settings.startHidden) {
  return { path: exePath(), args: hidden ? [...devArgs(), '--hidden'] : devArgs() };
}

function autostartEnabled() {
  return app.getLoginItemSettings(loginItemOptions(true)).openAtLogin || app.getLoginItemSettings(loginItemOptions(false)).openAtLogin;
}

function setAutostart(enabled) {
  for (const hidden of [true, false]) app.setLoginItemSettings({ ...loginItemOptions(hidden), openAtLogin: false });
  if (enabled) app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: true });
  pushState();
}

function applyLinkHandler() {
  if (!app.isPackaged) return;
  try {
    if (settings.handleLinks) app.setAsDefaultProtocolClient('whatsapp', exePath(), devArgs());
    else if (app.isDefaultProtocolClient('whatsapp', exePath(), devArgs())) app.removeAsDefaultProtocolClient('whatsapp', exePath(), devArgs());
  } catch {}
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: tr('Открыть Tandem Chat'), click: showWindow },
    { label: tr('Заблокировать'), enabled: !!settings.passcode && !locked, click: lock },
    { type: 'separator' },
    {
      label: tr('Тема'),
      submenu: Object.entries(THEMES).map(([id, label]) => ({ label: tr(label), type: 'radio', checked: settings.theme === id, click: () => setTheme(id) }))
    },
    { label: tr('Мини-режим'), click: miniMode },
    {
      label: tr('Запускать вместе с Windows'),
      type: 'checkbox',
      checked: autostartEnabled(),
      click: (item) => setAutostart(item.checked)
    },
    { type: 'separator' },
    { label: tr('Выход'), click: quit }
  ]);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(asset('tray.png')));
  tray.setToolTip('Tandem Chat');
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));
}

const PROBE_INTERVAL = 5 * 60 * 1000;

function probeStatuses(force) {
  if (!win || locked) return;
  const now = Date.now();
  for (const [id, v] of views) {
    const inUse = id === settings.activeId && win.isVisible() && win.isFocused() && !overlay;
    if (!v.loggedIn || (inUse && v.lastProbe)) continue;
    if (!force && now - v.lastProbe < PROBE_INTERVAL) continue;
    v.lastProbe = now;
    v.view.webContents.send('tandem:probe-status');
  }
}

function startAutoLock() {
  powerMonitor.on('lock-screen', () => settings.autoLockMinutes > 0 && lock());
  setInterval(() => {
    if (!settings.passcode || !settings.autoLockMinutes || locked) return;
    if (powerMonitor.getSystemIdleTime() >= settings.autoLockMinutes * 60) lock();
  }, 15000);
  setInterval(() => probeStatuses(), 60000);
}

const fromShell = (e) => shellView && e.sender === shellView.webContents;

function registerIpc() {
  ipcMain.on('tandem:notification-click', (e) => {
    const found = accountBySender(e.sender);
    showWindow();
    if (found && !locked) activate(found.id);
  });
  ipcMain.on('tandem:status', (e, status) => {
    const found = accountBySender(e.sender);
    if (!found || !status || typeof status !== 'object') return;
    const { v } = found;
    v.section = Number.isInteger(status.section) ? status.section : v.section;
    v.loggedIn = !!status.loggedIn;
    v.unseenStatus = Math.max(0, Math.min(999, Number(status.unseenStatus) || 0));
    v.avatar = typeof status.avatar === 'string' && /^https:\/\/[^/]*\.whatsapp\.net\//.test(status.avatar) ? status.avatar : null;
    pushState();
  });

  ipcMain.on('tandem:response', (e, res) => {
    if (!accountBySender(e.sender) || !res) return;
    const done = pending.get(res.rid);
    if (!done) return;
    pending.delete(res.rid);
    done({ ok: !!res.ok, result: res.result, error: res.error });
  });
  ipcMain.on('tandem:notify', (e, data) => {
    const found = accountBySender(e.sender);
    if (!found || !data || typeof data !== 'object' || !Number.isInteger(data.id) || data.closed) return;
    if (accountMuted(found.id)) return;
    if (win.isFocused() && win.isVisible() && found.id === settings.activeId && !locked) return;
    if (!locked) win.flashFrame(true);
    showNote(found.id, {
      id: data.id,
      title: String(data.title || '').slice(0, 200),
      body: String(data.body || '').slice(0, 500),
      icon: typeof data.icon === 'string' && data.icon.startsWith('data:image/') && data.icon.length < 400000 ? data.icon : null,
      silent: !!data.silent
    });
  });
  ipcMain.on('tandem:schedule-request', (e, data) => {
    const found = accountBySender(e.sender);
    if (!found || locked || !data || typeof data.text !== 'string' || typeof data.chatId !== 'string') return;
    openModal('schedule', { accountId: found.id, chatId: data.chatId, chatName: String(data.chatName || '').slice(0, 100), text: data.text.slice(0, 4000) });
  });
  ipcMain.on('tandem:edit-request', (e, data) => {
    const found = accountBySender(e.sender);
    if (!found || locked || !data || typeof data.id !== 'string') return;
    openModal('edit-message', { accountId: found.id, id: data.id, text: String(data.text || '') });
  });

  ipcMain.on('shell:i18n', (e) => {
    e.returnValue = fromShell(e) ? i18nPayload() : null;
  });
  ipcMain.on('tandem:i18n', (e) => {
    e.returnValue = accountBySender(e.sender) ? i18nPayload() : null;
  });
  ipcMain.handle('shell:schedule-add', async (e, data) => {
    if (!fromShell(e) || !data || !views.has(data.accountId)) return { ok: false, error: tr('Аккаунт не найден') };
    const at = Number(data.at);
    if (!Number.isFinite(at) || at < Date.now() - 60000) return { ok: false, error: tr('Это время уже прошло') };
    if (typeof data.text !== 'string' || !data.text.trim()) return { ok: false, error: tr('Пустое сообщение') };
    settings.scheduled.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      accountId: data.accountId,
      chatId: String(data.chatId),
      chatName: String(data.chatName || ''),
      text: data.text.slice(0, 4000),
      at
    });
    settings.scheduled.sort((a, b) => a.at - b.at);
    store.save(settings);
    const focused = await requestView(data.accountId, 'focus-composer', {});
    const target = views.get(data.accountId);
    if (focused.ok && focused.result && target) {
      sendKey(target.view.webContents, 'A', ['control']);
      sendKey(target.view.webContents, 'Backspace', []);
    }
    closeModal();
    pushState();
    return { ok: true };
  });
  ipcMain.on('shell:schedule-cancel', (e, id) => {
    if (!fromShell(e)) return;
    settings.scheduled = settings.scheduled.filter((m) => m.id !== id);
    store.save(settings);
    pushState();
  });
  ipcMain.handle('shell:edit-save', async (e, data) => {
    if (!fromShell(e) || !data || typeof data.text !== 'string' || !data.text.trim()) return { ok: false, error: tr('Пустое сообщение') };
    const res = await requestView(data.accountId, 'edit', { id: String(data.id), text: data.text.trim().slice(0, 4000) });
    if (!res.ok) return { ok: false, error: res.error || tr('Не удалось изменить') };
    closeModal();
    return { ok: true };
  });
  ipcMain.on('shell:setting', (e, key, value) => {
    if (!fromShell(e)) return;
    if (key === 'hideFilters') settings.hideFilters = !!value;
    else if (key === 'notifyStyle') settings.notifyStyle = value === 'system' ? 'system' : 'app';
    else if (key === 'language') settings.language = value === 'auto' ? 'auto' : 'app';
    else if (key === 'uiLanguage') {
      const next = value === 'en' ? 'en' : 'ru';
      if (next === settings.uiLanguage) return;
      settings.uiLanguage = next;
      store.save(settings);
      app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden' && !/^whatsapp:/i.test(a)) });
      return quit();
    } else if (key === 'badgeStyle') settings.badgeStyle = ['count', 'dot', 'none'].includes(value) ? value : 'count';
    else if (key === 'startHidden') {
      settings.startHidden = !!value;
      if (autostartEnabled()) setAutostart(true);
    } else if (key === 'handleLinks') {
      settings.handleLinks = !!value;
      applyLinkHandler();
    } else if (key === 'spellcheck') {
      settings.spellcheck = !!value;
      for (const account of settings.accounts) session.fromPartition(account.partition).setSpellCheckerEnabled(settings.spellcheck);
    } else if (key === 'downloads' && value && typeof value === 'object') {
      settings.downloads.mode = value.mode === 'ask' ? 'ask' : 'folder';
      settings.downloads.notify = !!value.notify;
    }
    else if (key === 'blur') settings.blur = !!value;
    else if (key === 'density') settings.density = value === 'normal' ? 'normal' : 'compact';
    else if (key === 'hideTyping') settings.hideTyping = !!value;
    else if (key === 'favoriteStyle') settings.favoriteStyle = !!value;
    else if (key === 'zoom') return setZoom(Number(value) || 1);
    else if (key === 'globalHotkey') {
      settings.globalHotkey = !!value;
      registerGlobalHotkey();
    } else if (key === 'themeMode') {
      settings.themeMode = ['manual', 'system', 'schedule'].includes(value) ? value : 'manual';
      store.save(settings);
      return refreshTheme(true);
    } else if (key === 'themeSchedule' && value && typeof value === 'object') {
      const time = (t, d) => (/^\d{2}:\d{2}$/.test(String(t)) ? String(t) : d);
      settings.themeSchedule = { from: time(value.from, '20:00'), to: time(value.to, '08:00') };
      store.save(settings);
      return refreshTheme(true);
    }
    else if (key === 'dnd' && value && typeof value === 'object') {
      const time = (t, d) => (/^\d{2}:\d{2}$/.test(String(t)) ? String(t) : d);
      settings.dnd = { enabled: !!value.enabled, from: time(value.from, '23:00'), to: time(value.to, '08:00') };
    } else return;
    store.save(settings);
    pushState();
  });
  ipcMain.handle('shell:downloads-pick', async (e) => {
    if (!fromShell(e)) return { ok: false };
    const res = await dialog.showOpenDialog(win, { title: tr('Выберите папку для загрузок'), defaultPath: downloadDir(), properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    settings.downloads.folder = res.filePaths[0];
    store.save(settings);
    pushState();
    return { ok: true };
  });
  ipcMain.on('shell:downloads-open', (e) => fromShell(e) && shell.openPath(downloadDir()));
  ipcMain.on('shell:account-muted', (e, id, muted) => {
    if (!fromShell(e)) return;
    const account = settings.accounts.find((a) => a.id === id);
    if (!account) return;
    account.muted = !!muted;
    store.save(settings);
    pushState();
  });

  ipcMain.handle('shell:chat-list', async (e) => {
    if (!fromShell(e)) return [];
    const res = await requestView(settings.activeId, 'chat-list', {});
    return res.ok && Array.isArray(res.result) ? res.result : [];
  });
  ipcMain.handle('shell:forward', async (e, data) => {
    if (!fromShell(e) || !data) return { ok: false };
    const res = await requestView(data.accountId, 'forward', { msgId: String(data.msgId), targetId: String(data.targetId) });
    if (res.ok) closeModal();
    return res.ok ? { ok: true } : { ok: false, error: res.error || tr('Не удалось переслать') };
  });
  ipcMain.handle('shell:reminder-add', (e, data) => {
    if (!fromShell(e) || !data) return { ok: false };
    const at = Number(data.at);
    if (!Number.isFinite(at) || at <= Date.now()) return { ok: false, error: tr('Выберите время в будущем') };
    settings.reminders.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      accountId: String(data.accountId),
      chatId: String(data.chatId || ''),
      chatName: String(data.chatName || '').slice(0, 100),
      text: String(data.text || '').slice(0, 300),
      at
    });
    settings.reminders.sort((a, b) => a.at - b.at);
    store.save(settings);
    closeModal();
    pushState();
    return { ok: true };
  });
  ipcMain.on('shell:reminder-cancel', (e, id) => {
    if (!fromShell(e)) return;
    settings.reminders = settings.reminders.filter((r) => r.id !== id);
    store.save(settings);
    pushState();
  });
  ipcMain.handle('shell:folder-save', (e, folder) => {
    if (!fromShell(e) || !folder || typeof folder.name !== 'string' || !folder.name.trim()) return { ok: false, error: tr('Введите название') };
    const clean = {
      id: folder.id || Date.now().toString(36),
      name: folder.name.trim().slice(0, 30),
      chatIds: Array.isArray(folder.chatIds) ? folder.chatIds.map(String).slice(0, 300) : []
    };
    const index = settings.folders.findIndex((f) => f.id === clean.id);
    if (index >= 0) settings.folders[index] = clean;
    else settings.folders.push(clean);
    store.save(settings);
    closeModal();
    pushState();
    return { ok: true };
  });
  ipcMain.on('shell:folder-delete', (e, id) => {
    if (!fromShell(e)) return;
    settings.folders = settings.folders.filter((f) => f.id !== id);
    store.save(settings);
    closeModal();
    pushState();
  });
  ipcMain.on('shell:locked-chats', (e, ids) => {
    if (!fromShell(e) || !Array.isArray(ids)) return;
    settings.lockedChats = ids.map(String).slice(0, 300);
    store.save(settings);
    closeModal();
    pushState();
  });
  ipcMain.on('shell:templates', (e, list) => {
    if (!fromShell(e) || !Array.isArray(list)) return;
    settings.templates = list
      .filter((t) => t && typeof t.key === 'string' && typeof t.text === 'string' && t.key.trim() && t.text.trim())
      .map((t) => ({ key: t.key.trim().replace(/^\//, '').replace(/\s+/g, '').slice(0, 20), text: t.text.slice(0, 2000) }))
      .slice(0, 100);
    store.save(settings);
    pushState();
  });
  ipcMain.on('shell:account-sound', (e, id, sound) => {
    if (!fromShell(e)) return;
    const account = settings.accounts.find((a) => a.id === id);
    if (!account || !['note', 'bell', 'drop', 'none'].includes(sound)) return;
    account.sound = sound;
    store.save(settings);
    pushState();
  });
  ipcMain.on('shell:mini-mode', (e) => fromShell(e) && (closeModal(), miniMode()));
  ipcMain.on('shell:favorite', (e, action) => {
    if (!fromShell(e) || locked) return;
    closeModal();
    requestView(settings.activeId, action === 'pin' ? 'pin-self' : 'open-self', {});
  });
  ipcMain.on('tandem:page-modal', (e, name, data) => {
    const found = accountBySender(e.sender);
    if (!found || locked || !['forward', 'remind', 'folder', 'lock-chats'].includes(name)) return;
    openModal(name, { ...(data && typeof data === 'object' ? data : {}), accountId: found.id });
  });
  ipcMain.on('tandem:template-apply', (e, text) => {
    const found = accountBySender(e.sender);
    if (!found || typeof text !== 'string') return;
    const wc = found.v.view.webContents;
    sendKey(wc, 'A', ['control']);
    wc.insertText(text);
  });
  ipcMain.handle('tandem:unlock-chat', (e, code) => {
    if (!accountBySender(e.sender)) return { ok: false };
    if (!settings.passcode) return { ok: true };
    return store.checkPasscode(settings.passcode, String(code || '')) ? { ok: true } : { ok: false, error: tr('Неверный код-пароль') };
  });
  ipcMain.on('tandem:diag', (e, checks) => {
    const found = accountBySender(e.sender);
    if (!found || !checks || typeof checks !== 'object') return;
    found.v.diag = Object.fromEntries(Object.entries(checks).slice(0, 40).map(([k, val]) => [String(k).slice(0, 40), !!val]));
    pushState();
  });

  ipcMain.on('shell:test-note', (e) => {
    if (!fromShell(e)) return;
    if (settings.notifyStyle === 'system') {
      new Notification({ title: 'Tandem Chat', body: tr('Так будут выглядеть уведомления'), icon: asset('icon.png'), silent: soundFor(settings.activeId) === 'none' }).show();
      return;
    }
    notifier.show({
      kind: 'test',
      accountId: settings.activeId,
      title: 'Tandem Chat',
      body: tr('Так будут выглядеть уведомления. Нажмите «Ответить», чтобы увидеть поле ответа.'),
      icon: null,
      silent: false,
      sound: soundFor(settings.activeId),
      account: '',
      canReply: true
    });
  });

  const BACKUP_KEYS = ['theme', 'themeMode', 'themeSchedule', 'zoom', 'density', 'blur', 'globalHotkey', 'hideTyping', 'favoriteStyle', 'templates', 'folders', 'lockedChats', 'hideFilters', 'notifyStyle', 'language', 'dnd', 'autoLockMinutes', 'badgeStyle', 'startHidden', 'handleLinks', 'spellcheck', 'downloads'];

  ipcMain.handle('shell:backup-export', async (e) => {
    if (!fromShell(e)) return { ok: false };
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await dialog.showSaveDialog(win, {
      title: tr('Сохранить настройки Tandem Chat'),
      defaultPath: path.join(app.getPath('documents'), `tandem-chat-settings-${stamp}.json`),
      filters: [{ name: tr('Настройки Tandem Chat'), extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    const data = {
      app: 'Tandem Chat',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: Object.fromEntries(BACKUP_KEYS.map((k) => [k, settings[k]])),
      accounts: settings.accounts.map((a) => ({ id: a.id, name: a.name, color: a.color, sound: a.sound || 'note', muted: !!a.muted }))
    };
    try {
      fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2));
      return { ok: true, file: path.basename(res.filePath) };
    } catch (err) {
      return { ok: false, error: tr('Не удалось сохранить файл') };
    }
  });

  ipcMain.handle('shell:backup-import', async (e) => {
    if (!fromShell(e)) return { ok: false };
    const res = await dialog.showOpenDialog(win, {
      title: tr('Восстановить настройки Tandem Chat'),
      properties: ['openFile'],
      filters: [{ name: tr('Настройки Tandem Chat'), extensions: ['json'] }]
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    let data;
    try {
      data = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
    } catch {
      return { ok: false, error: tr('Файл повреждён или это не JSON') };
    }
    if (!data || data.app !== 'Tandem Chat' || !data.settings || typeof data.settings !== 'object') return { ok: false, error: tr('Это не файл настроек Tandem Chat') };
    const defaults = store.defaults();
    for (const key of BACKUP_KEYS) {
      const value = data.settings[key];
      if (value === undefined || value === null) continue;
      const expected = defaults[key];
      if (Array.isArray(expected) ? !Array.isArray(value) : typeof value !== typeof expected) continue;
      settings[key] = value;
    }
    store.normalize(settings);
    if (!THEMES[settings.theme]) settings.theme = defaults.theme;
    applyLinkHandler();
    for (const account of settings.accounts) session.fromPartition(account.partition).setSpellCheckerEnabled(!!settings.spellcheck);
    if (Array.isArray(data.accounts)) {
      for (const saved of data.accounts) {
        const account = settings.accounts.find((a) => a.id === saved.id);
        if (!account) continue;
        if (typeof saved.name === 'string' && saved.name.trim()) account.name = saved.name.trim().slice(0, 40);
        if (['note', 'bell', 'drop', 'none'].includes(saved.sound)) account.sound = saved.sound;
        account.muted = !!saved.muted;
      }
    }
    store.save(settings);
    registerGlobalHotkey();
    for (const v of views.values()) v.view.webContents.setZoomFactor(settings.zoom);
    refreshTheme(true);
    pushState();
    return { ok: true };
  });

  ipcMain.on('tandem:menu', (e) => accountBySender(e.sender) && !locked && openModal('drawer'));
  ipcMain.on('tandem:switch', (e, id) => accountBySender(e.sender) && !locked && activate(id));
  ipcMain.on('tandem:back', (e) => {
    const found = accountBySender(e.sender);
    if (found) sendKey(found.v.view.webContents, 'Escape', []);
  });

  ipcMain.on('shell:activate', (e, id) => fromShell(e) && !locked && activate(id));
  ipcMain.on('shell:wa-action', (e, action) => {
    if (!fromShell(e) || locked) return;
    const v = activeView();
    if (!v) return;
    closeModal();
    v.view.webContents.send('tandem:action', action);
  });
  ipcMain.on('shell:section', (e, index) => {
    if (!fromShell(e) || locked) return;
    if (overlay) closeModal();
    const v = activeView();
    if (v) {
      v.view.webContents.send('tandem:open-section', index);
      v.view.webContents.focus();
    }
  });
  ipcMain.on('shell:modal', (e, name) => fromShell(e) && !locked && openModal(name));
  ipcMain.on('shell:close-modal', (e) => fromShell(e) && closeModal());
  ipcMain.on('shell:lock', (e) => fromShell(e) && lock());
  ipcMain.handle('shell:unlock', (e, code) => (fromShell(e) ? unlock(String(code || '')) : { ok: false }));
  ipcMain.on('shell:theme', (e, theme) => fromShell(e) && setTheme(theme));
  ipcMain.on('shell:autostart', (e, enabled) => fromShell(e) && setAutostart(enabled));
  ipcMain.on('shell:autolock', (e, minutes) => {
    if (!fromShell(e)) return;
    settings.autoLockMinutes = [0, 1, 5, 15, 60].includes(Number(minutes)) ? Number(minutes) : 0;
    store.save(settings);
    pushState();
  });
  ipcMain.handle('shell:set-passcode', (e, current, next) => {
    if (!fromShell(e)) return { ok: false };
    if (settings.passcode && !store.checkPasscode(settings.passcode, String(current || ''))) return { ok: false, error: tr('Текущий код-пароль неверный') };
    if (next === null) {
      settings.passcode = null;
    } else {
      if (typeof next !== 'string' || next.length < 4) return { ok: false, error: tr('Минимум 4 символа') };
      settings.passcode = store.hashPasscode(next);
    }
    store.save(settings);
    pushState();
    return { ok: true };
  });
  ipcMain.on('shell:add-account', (e, name) => {
    if (!fromShell(e) || locked) return;
    const account = store.newAccount(settings, typeof name === 'string' ? name.trim().slice(0, 40) : '');
    settings.accounts.push(account);
    store.save(settings);
    createAccountView(account);
    activate(account.id);
  });
  ipcMain.on('shell:rename-account', (e, id, name) => {
    if (!fromShell(e) || typeof name !== 'string' || !name.trim()) return;
    const account = settings.accounts.find((a) => a.id === id);
    if (!account) return;
    account.name = name.trim().slice(0, 40);
    store.save(settings);
    pushState();
  });
  ipcMain.on('shell:remove-account', async (e, id) => {
    if (!fromShell(e) || locked || settings.accounts.length <= 1) return;
    const account = settings.accounts.find((a) => a.id === id);
    const v = views.get(id);
    if (!account || !v) return;
    settings.accounts = settings.accounts.filter((a) => a.id !== id);
    if (settings.activeId === id) settings.activeId = settings.accounts[0].id;
    store.save(settings);
    views.delete(id);
    win.contentView.removeChildView(v.view);
    v.view.webContents.close();
    restack();
    pushState();
    await session.fromPartition(account.partition).clearStorageData().catch(() => {});
  });
  ipcMain.handle('shell:tray-base', (e) => {
    if (!fromShell(e)) return {};
    return { x1: nativeImage.createFromPath(asset('tray.png')).toDataURL(), x2: nativeImage.createFromPath(asset('tray@2x.png')).toDataURL() };
  });
  ipcMain.on('shell:badge', (e, dataUrl, count, tray1, tray2) => {
    if (!fromShell(e) || !win) return;
    const png = (u) => typeof u === 'string' && u.startsWith('data:image/png');
    if (count > 0 && png(dataUrl)) {
      win.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), tr(`${count} непрочитанных`));
    } else {
      win.setOverlayIcon(null, '');
    }
    if (!tray) return;
    if (count > 0 && png(tray1) && png(tray2)) {
      const image = nativeImage.createEmpty();
      image.addRepresentation({ scaleFactor: 1, dataURL: tray1 });
      image.addRepresentation({ scaleFactor: 2, dataURL: tray2 });
      tray.setImage(image);
    } else {
      tray.setImage(nativeImage.createFromPath(asset('tray.png')));
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    showWindow();
    const link = linkArg(argv);
    if (link && settings) openOutside(link, settings.activeId);
  });
  app.setAppUserModelId('app.tandemchat.desktop');

  app.whenReady().then(() => {
    settings = store.load();
    settings.onTop = false;
    if (!app.isPackaged && app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }).openAtLogin) {
      app.setLoginItemSettings({ path: process.execPath, args: ['--hidden'], openAtLogin: false });
      app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: true });
    }
    locked = !!settings.passcode;
    Menu.setApplicationMenu(null);
    registerIpc();
    createWindow();
    createTray();
    startAutoLock();
    notifier = new Notifier({
      getTheme: themeInfo,
      getLabels: () => ({
        close: tr('Закрыть'),
        reply: tr('Ответить'),
        placeholder: tr('Ваш ответ…'),
        send: tr('Отправить (Enter)'),
        failed: tr('Не удалось отправить')
      }),
      onOpen: (note) => {
        showWindow();
        if (locked) return;
        activate(note.accountId);
        if (note.kind === 'test') return;
        if (note.kind === 'reminder') requestView(note.accountId, 'open', { chatId: note.chatId });
        else requestView(note.accountId, 'note', { id: note.id, action: 'open' });
      },
      onReply: async (note, text) => {
        if (note.kind === 'test') return { ok: true };
        if (locked) return { ok: false, error: tr('Tandem Chat заблокирован') };
        const res = await requestView(note.accountId, 'note', { id: note.id, action: 'reply', text });
        return res.ok ? { ok: true } : { ok: false, error: res.error || tr('Не удалось отправить') };
      }
    });
    setInterval(runScheduled, 10000);
    setInterval(runReminders, 10000);
    registerGlobalHotkey();
    nativeTheme.on('updated', () => refreshTheme());
    appliedTheme = currentTheme();
    setInterval(tickMinute, 30000);
    tickMinute();
    applyLinkHandler();
    const link = linkArg(process.argv);
    if (link) openOutside(link, settings.activeId);
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}
