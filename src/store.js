const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];

const defaults = () => ({
  theme: 'blue-dark',
  bounds: { width: 1240, height: 820 },
  maximized: false,
  accounts: [{ id: 'main', name: 'Аккаунт 1', partition: 'persist:whatsapp', color: COLORS[2] }],
  activeId: 'main',
  passcode: null,
  autoLockMinutes: 0,
  hideFilters: false,
  notifyStyle: 'app',
  language: 'app',
  uiLanguage: 'ru',
  badgeStyle: 'count',
  startHidden: true,
  handleLinks: true,
  spellcheck: true,
  downloads: { mode: 'folder', folder: '', notify: true, lastDir: '' },
  dnd: { enabled: false, from: '23:00', to: '08:00' },
  scheduled: [],
  themeMode: 'manual',
  themeSchedule: { from: '20:00', to: '08:00' },
  zoom: 1,
  density: 'compact',
  blur: false,
  globalHotkey: true,
  onTop: false,
  hideTyping: false,
  favoriteStyle: true,
  templates: [],
  folders: [],
  lockedChats: [],
  reminders: []
});

const file = () => path.join(app.getPath('userData'), 'settings.json');

function load() {
  const base = defaults();
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const merged = { ...base, ...saved };
    if (!Array.isArray(merged.accounts) || !merged.accounts.length) merged.accounts = base.accounts;
    if (!merged.accounts.some((a) => a.id === merged.activeId)) merged.activeId = merged.accounts[0].id;
    if (!Array.isArray(merged.scheduled)) merged.scheduled = [];
    merged.dnd = { ...base.dnd, ...(merged.dnd || {}) };
    merged.themeSchedule = { ...base.themeSchedule, ...(merged.themeSchedule || {}) };
    for (const key of ['templates', 'folders', 'lockedChats', 'reminders']) if (!Array.isArray(merged[key])) merged[key] = [];
    return normalize(merged);
  } catch {
    return base;
  }
}

function normalize(settings) {
  const base = defaults();
  if (settings.language !== 'auto') settings.language = 'app';
  if (settings.notifyStyle !== 'system') settings.notifyStyle = 'app';
  if (settings.theme === 'telegram-dark') settings.theme = 'blue-dark';
  if (settings.theme === 'telegram-light') settings.theme = 'blue-light';
  if (settings.uiLanguage !== 'en') settings.uiLanguage = 'ru';
  if (!['count', 'dot', 'none'].includes(settings.badgeStyle)) settings.badgeStyle = base.badgeStyle;
  const downloads = settings.downloads && typeof settings.downloads === 'object' ? settings.downloads : {};
  settings.downloads = {
    mode: downloads.mode === 'ask' ? 'ask' : 'folder',
    folder: typeof downloads.folder === 'string' ? downloads.folder : '',
    notify: downloads.notify !== false,
    lastDir: typeof downloads.lastDir === 'string' ? downloads.lastDir : ''
  };
  return settings;
}

function save(settings) {
  try {
    fs.writeFileSync(file(), JSON.stringify(settings, null, 2));
  } catch {}
}

function newAccount(settings, name) {
  const id = crypto.randomBytes(6).toString('hex');
  const color = COLORS[settings.accounts.length % COLORS.length];
  return { id, name: name || `Аккаунт ${settings.accounts.length + 1}`, partition: `persist:wa-${id}`, color };
}

function hashPasscode(code) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(code, salt, 32);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function checkPasscode(stored, code) {
  if (!stored || typeof code !== 'string') return false;
  const expected = Buffer.from(stored.hash, 'hex');
  const actual = crypto.scryptSync(code, Buffer.from(stored.salt, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = { load, save, defaults, normalize, newAccount, hashPasscode, checkPasscode };
