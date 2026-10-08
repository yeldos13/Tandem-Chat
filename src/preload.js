const { contextBridge, ipcRenderer, webFrame } = require('electron');

const I18N = ipcRenderer.sendSync('tandem:i18n') || { lang: 'ru', EN: {}, PATTERNS: [] };
const LOCALE = I18N.lang === 'en' ? 'en-US' : 'ru-RU';
const PATTERNS = I18N.PATTERNS.map(([source, out]) => [new RegExp(source), out]);

function tr(text) {
  if (I18N.lang !== 'en' || typeof text !== 'string' || !text) return text;
  if (Object.prototype.hasOwnProperty.call(I18N.EN, text)) return I18N.EN[text];
  const trimmed = text.trim();
  if (trimmed !== text && Object.prototype.hasOwnProperty.call(I18N.EN, trimmed)) return text.replace(trimmed, I18N.EN[trimmed]);
  for (const [re, out] of PATTERNS) if (re.test(trimmed)) return text.replace(trimmed, trimmed.replace(re, out));
  return text;
}

let ui = {
  compact: false,
  accounts: [],
  activeId: null,
  locked: false,
  muted: false,
  notifyStyle: 'app',
  hideFilters: false,
  language: 'app',
  blur: false,
  density: 'compact',
  hideTyping: false,
  favoriteStyle: true,
  templates: [],
  folders: [],
  lockedChats: []
};
const unlockedChats = new Set();

contextBridge.exposeInMainWorld('tandem', {
  notificationClicked: () => ipcRenderer.send('tandem:notification-click'),
  notify: (payload) => ipcRenderer.send('tandem:notify', payload),
  isLocked: () => !!ui.locked,
  isMuted: () => !!ui.muted,
  customNotes: () => ui.notifyStyle === 'app',
  tr: (text) => tr(String(text)),
  isChatHidden: (tag) => ui.lockedChats.includes(String(tag)) && !unlockedChats.has(String(tag))
});

function mainWorld() {
  if (window.__wg) return;
  const tr = (text) => (window.tandem && window.tandem.tr ? window.tandem.tr(text) : text);
  const req = (name) => window.require(name);
  const chats = () => req('WAWebChatCollection').ChatCollection;
  const isGroup = (c) => !!(c.id && c.id.server === 'g.us');
  const isChannel = (c) => !!(c.id && c.id.server === 'newsletter');
  const hasUnread = (c) => c.unreadCount > 0 || c.unreadCount === -1;
  const titleOf = (c) => {
    try {
      return c.formattedTitle || c.name || '';
    } catch {
      return '';
    }
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const JID = /@(c\.us|g\.us|lid|newsletter|broadcast)$/;

  const Native = window.Notification;
  const notes = new Map();
  let seq = 0;

  const toDataUrl = async (url) => {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith('data:image/')) return url;
    try {
      const blob = await (await fetch(url)).blob();
      if (!blob.type.startsWith('image/')) return null;
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  function makeFake(title, options) {
    const id = ++seq;
    const fake = new EventTarget();
    Object.assign(fake, {
      title,
      body: options.body || '',
      tag: options.tag || '',
      icon: options.icon || '',
      data: options.data,
      silent: !!options.silent,
      onclick: null,
      onclose: null,
      onshow: null,
      onerror: null,
      close() {
        notes.delete(id);
        window.tandem && window.tandem.notify({ id, closed: true });
      }
    });
    notes.set(id, fake);
    if (notes.size > 50) notes.delete(notes.keys().next().value);
    return { id, fake };
  }

  function fire(fake, type) {
    const event = new Event(type);
    fake.dispatchEvent(event);
    const handler = fake['on' + type];
    if (typeof handler === 'function') handler.call(fake, event);
  }

  function TandemNotification(title, options = {}) {
    const api = window.tandem;
    if (api && api.isMuted()) return makeFake(title, options).fake;
    if (api && api.isChatHidden(options.tag)) {
      options = { tag: options.tag, silent: options.silent, body: tr('Новое сообщение в защищённом чате') };
      title = 'Tandem Chat';
    }
    if (api && api.customNotes()) {
      const { id, fake } = makeFake(title, options);
      toDataUrl(options.icon).then((icon) => {
        api.notify({ id, title: String(title || ''), body: String(options.body || ''), tag: String(options.tag || ''), icon, silent: !!options.silent });
      });
      return fake;
    }
    const hidden = api && api.isLocked();
    const native = new Native(hidden ? 'Tandem Chat' : title, hidden ? { body: tr('Новое сообщение'), tag: options.tag, silent: options.silent } : options);
    native.addEventListener('click', () => api && api.notificationClicked());
    return native;
  }
  if (Native) {
    TandemNotification.prototype = Native.prototype;
    Object.defineProperty(TandemNotification, 'permission', { get: () => Native.permission });
    Object.defineProperty(TandemNotification, 'maxActions', { get: () => Native.maxActions });
    TandemNotification.requestPermission = (...args) => Native.requestPermission(...args);
    window.Notification = TandemNotification;
  }

  const LABELS = { image: tr('Фото'), video: tr('Видео'), ptt: tr('Голосовое сообщение'), audio: tr('Аудио'), document: tr('Документ'), sticker: tr('Стикер'), call_log: tr('Звонок'), location: tr('Геопозиция'), vcard: tr('Контакт'), poll_creation: tr('Опрос'), revoked: tr('Сообщение удалено') };
  const plainText = (m) => (m.type === 'chat' ? m.body || '' : m.caption || '');
  const msgText = (m) => plainText(m) || LABELS[m.type] || tr('Сообщение');
  const authorOf = (m) => {
    try {
      return (m.senderObj && (m.senderObj.formattedName || m.senderObj.pushname)) || '';
    } catch {
      return '';
    }
  };
  const previewOf = (c) => {
    try {
      const msgs = c.msgs ? c.msgs.getModelsArray() : [];
      const m = msgs[msgs.length - 1];
      if (!m) return '';
      return (m.id && m.id.fromMe ? tr('Вы: ') : '') + msgText(m);
    } catch {
      return '';
    }
  };
  const selfChat = () => {
    try {
      const me = req('WAWebUserPrefsMeUser');
      const users = [me.getMaybeMeLidUser(), me.getMaybeMePnUser()].filter(Boolean).map((w) => w.user);
      return chats()
        .getModelsArray()
        .find((c) => c.id && users.includes(c.id.user));
    } catch {
      return null;
    }
  };

  const activeChat = () => {
    const col = chats();
    return col.getActive ? col.getActive() : null;
  };

  const sendText = async (chat, text) => {
    await req('WAWebSendTextMsgChatAction').sendTextMsgToChat(chat, text);
    return true;
  };

  let pendingDrop = null;
  const nativeInputClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file' && pendingDrop) {
      const files = pendingDrop;
      pendingDrop = null;
      const transfer = new DataTransfer();
      for (const f of files) transfer.items.add(f);
      this.files = transfer.files;
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    return nativeInputClick.call(this);
  };

  const waitFor = async (fn, timeout = 4000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = fn();
      if (value) return value;
      await wait(80);
    }
    return null;
  };

  window.__wg = {
    async dropFiles(chatId) {
      const holder = document.getElementById('wg-drop-holder');
      const files = holder && holder.files ? [...holder.files] : [];
      if (!files.length) throw new Error(tr('Нет файлов'));
      const chat = chatId ? chats().get(chatId) : activeChat();
      if (!chat) throw new Error(tr('Чат не найден'));
      if (activeChat() !== chat) await req('WAWebCmd').Cmd.openChatBottom({ chat });
      const attach = await waitFor(() => {
        const footer = document.querySelector('#main footer');
        return footer && activeChat() === chat ? footer.querySelector('button') : null;
      });
      if (!attach) throw new Error(tr('Чат не открылся'));
      const media = files.every((f) => /^(image|video)\//.test(f.type));
      const icon = media ? 'ic-filter-filled' : 'ic-description-filled';
      attach.click();
      const item = await waitFor(() =>
        [...document.querySelectorAll('[role=menu] [role=menuitem], #wa-popovers-bucket li')].find((i) => [...i.querySelectorAll('svg title')].some((t) => t.textContent === icon))
      );
      if (!item) throw new Error(tr('Меню вложений не открылось'));
      pendingDrop = files;
      item.click();
      setTimeout(() => {
        pendingDrop = null;
      }, 3000);
      holder.value = '';
      return files.length;
    },
    summary() {
      if (typeof window.require !== 'function') return null;
      let list;
      try {
        list = chats().getModelsArray();
      } catch {
        return null;
      }
      const live = list.filter((c) => !c.archive);
      const unread = live.filter(hasUnread);
      const counts = {
        'all-filter': unread.length,
        label_item_1: unread.length,
        label_item_2: unread.filter((c) => c.isFavorite).length,
        label_item_3: unread.filter(isGroup).length
      };
      const kinds = {};
      const ids = {};
      const self = selfChat();
      for (const c of list) {
        const t = titleOf(c);
        if (!t) continue;
        ids[t] = String(c.id);
        const kind = c === self ? 'self' : isChannel(c) ? 'channel' : isGroup(c) ? 'group' : null;
        if (kind) kinds[t] = kind;
      }
      const active = activeChat();
      return { counts, kinds, ids, activeId: active ? String(active.id) : null };
    },
    reply(dataId) {
      const row = [...document.querySelectorAll('#main [data-id]')].find((r) => r.getAttribute('data-id') === dataId);
      if (!row) return false;
      row.focus();
      req('WAWebCmd').Cmd.replyCurrentMessageKeyboardShortcut();
      return true;
    },
    lastEditable() {
      const chat = activeChat();
      if (!chat || !chat.msgs) return null;
      const cap = req('WAWebMsgActionCapability');
      const msgs = chat.msgs.getModelsArray();
      for (let i = msgs.length - 1; i >= 0 && i >= msgs.length - 40; i--) {
        const m = msgs[i];
        if (!m.id || !m.id.fromMe || m.type !== 'chat') continue;
        try {
          if (cap.canEditText && !cap.canEditText(m)) return null;
        } catch {
          return null;
        }
        return { id: String(m.id), text: m.body || '' };
      }
      return null;
    },
    async edit(id, text) {
      const parts = String(id).split('_');
      const owner = parts.length >= 3 ? chats().get(parts[1]) : null;
      const chat = activeChat();
      const msg = (owner && owner.msgs && owner.msgs.get(id)) || (chat && chat.msgs && chat.msgs.get(id));
      if (!msg) throw new Error(tr('Сообщение не найдено'));
      await req('WAWebSendMessageEditAction').sendMessageEdit(msg, text, {});
      return true;
    },
    chatList() {
      let pics = null;
      try {
        pics = req('WAWebProfilePicThumbCollection').ProfilePicThumbCollection;
      } catch {}
      const self = selfChat();
      return chats()
        .getModelsArray()
        .slice()
        .sort((a, b) => (b.t || 0) - (a.t || 0))
        .slice(0, 800)
        .map((c) => {
          let pic = null;
          try {
            const thumb = pics && pics.get(c.id);
            pic = thumb && thumb.eurl ? thumb.eurl : null;
          } catch {}
          return {
            id: String(c.id),
            title: titleOf(c),
            kind: isChannel(c) ? 'channel' : isGroup(c) ? 'group' : 'user',
            unread: c.unreadCount > 0 ? c.unreadCount : c.unreadCount === -1 ? 1 : 0,
            muted: !!(c.mute && c.mute.expiration) || !!c.muteExpiration,
            archive: !!c.archive,
            t: c.t || 0,
            pic,
            self: c === self,
            preview: previewOf(c)
          };
        });
    },
    async preview(id) {
      const chat = chats().get(id);
      if (!chat) throw new Error(tr('Чат не найден'));
      try {
        if (!chat.msgs || chat.msgs.length < 10) await req('WAWebChatLoadMessages').loadEarlierMsgs({ chat });
      } catch {}
      const msgs = chat.msgs ? chat.msgs.getModelsArray().slice(-14) : [];
      return {
        title: titleOf(chat),
        group: isGroup(chat),
        messages: msgs.map((m) => ({
          fromMe: !!(m.id && m.id.fromMe),
          text: msgText(m),
          t: m.t || 0,
          author: isGroup(chat) && !(m.id && m.id.fromMe) ? authorOf(m) : ''
        }))
      };
    },
    async open(id) {
      const chat = chats().get(id);
      if (!chat) throw new Error(tr('Чат не найден'));
      await req('WAWebCmd').Cmd.openChatBottom({ chat });
      return true;
    },
    selfId() {
      const chat = selfChat();
      return chat ? String(chat.id) : null;
    },
    async openSelf() {
      const chat = selfChat();
      if (!chat) throw new Error(tr('Чат «Сообщения себе» не найден'));
      await req('WAWebCmd').Cmd.openChatBottom({ chat });
      return true;
    },
    pinSelf() {
      const chat = selfChat();
      if (!chat) throw new Error(tr('Чат «Сообщения себе» не найден'));
      req('WAWebCmd').Cmd.pinChat(chat, true);
      return true;
    },
    msgInfo(dataId) {
      const chat = activeChat();
      if (!chat || !chat.msgs) return null;
      const m = chat.msgs.getModelsArray().find((x) => x.id && x.id.id === dataId);
      if (!m) return null;
      return { id: String(m.id), text: msgText(m), forwardable: !!plainText(m), chatId: String(chat.id), chatName: titleOf(chat) };
    },
    async forward(msgId, targetId) {
      const parts = String(msgId).split('_');
      const owner = parts.length >= 3 ? chats().get(parts[1]) : null;
      const m = owner && owner.msgs ? owner.msgs.get(msgId) : null;
      if (!m) throw new Error(tr('Сообщение не найдено'));
      const text = plainText(m);
      if (!text) throw new Error(tr('Пока можно пересылать только текст и подписи'));
      const target = targetId === 'self' ? selfChat() : chats().get(targetId);
      if (!target) throw new Error(tr('Чат не найден'));
      await sendText(target, text);
      return true;
    },
    setHideTyping(on) {
      let bridge = null;
      try {
        bridge = req('WAWebChatStateBridge');
      } catch {}
      if (!bridge || typeof bridge.sendChatStateComposing !== 'function') return false;
      if (!bridge.__wgOriginal) bridge.__wgOriginal = { composing: bridge.sendChatStateComposing, recording: bridge.sendChatStateRecording };
      const noop = () => Promise.resolve();
      bridge.sendChatStateComposing = on ? noop : bridge.__wgOriginal.composing;
      bridge.sendChatStateRecording = on ? noop : bridge.__wgOriginal.recording;
      return true;
    },
    diagnostics() {
      const has = (name, key) => {
        try {
          const m = req(name);
          return key ? key.split('.').reduce((o, k) => o && o[k], m) !== undefined : !!m;
        } catch {
          return false;
        }
      };
      return {
        'Список чатов': has('WAWebChatCollection', 'ChatCollection'),
        'Ответ двойным кликом': has('WAWebCmd', 'Cmd.replyCurrentMessageKeyboardShortcut'),
        'Отправка сообщений': has('WAWebSendTextMsgChatAction', 'sendTextMsgToChat'),
        'Редактирование': has('WAWebSendMessageEditAction', 'sendMessageEdit'),
        'Язык': has('WAWebL10N', 'setLocale'),
        'Скрытие «печатает»': has('WAWebChatStateBridge', 'sendChatStateComposing'),
        'Аватары': has('WAWebProfilePicThumbCollection', 'ProfilePicThumbCollection'),
        'Предпросмотр': has('WAWebChatLoadMessages', 'loadRecentMsgs')
      };
    },
    async ensureLocale(locale) {
      const L = req('WAWebL10N');
      const current = String(L.getLocale() || '');
      if (current.slice(0, 2) === locale.slice(0, 2)) return false;
      await L.setLocale(locale);
      return true;
    },
    closeChat() {
      const Cmd = req('WAWebCmd').Cmd;
      const chat = activeChat();
      if (Cmd.closeActiveChat) Cmd.closeActiveChat();
      else if (chat) Cmd.closeChat(chat);
      return true;
    },
    activeChat() {
      const chat = activeChat();
      return chat ? { id: String(chat.id), name: titleOf(chat) } : null;
    },
    async send(chatId, text) {
      const chat = chats().get(chatId);
      if (!chat) throw new Error(tr('Чат не найден'));
      return sendText(chat, text);
    },
    async noteAction(id, action, text) {
      const fake = notes.get(id);
      if (!fake) throw new Error(tr('Уведомление устарело'));
      if (action === 'open') {
        fire(fake, 'click');
        return true;
      }
      if (action === 'reply') {
        let chat = JID.test(fake.tag) ? chats().get(fake.tag) : null;
        if (!chat) {
          fire(fake, 'click');
          await wait(800);
          chat = activeChat();
        }
        if (!chat) throw new Error(tr('Не удалось определить чат'));
        await sendText(chat, text);
        notes.delete(id);
        return true;
      }
      if (action === 'dismiss') notes.delete(id);
      return true;
    }
  };
}

webFrame.executeJavaScript('(' + mainWorld.toString() + ')()');

const callMain = (fn, ...args) => webFrame.executeJavaScript(`window.__wg && window.__wg.${fn}(...${JSON.stringify(args)})`);

let typingApplied = null;
function applyTyping() {
  const want = !!ui.hideTyping;
  if (typingApplied === want) return;
  typingApplied = want;
  callMain('setHideTyping', want)
    .then((done) => {
      if (!done) typingApplied = null;
    })
    .catch(() => {
      typingApplied = null;
    });
}
ipcRenderer.on('tandem:ui', (_e, next) => {
  if (next.locked && !ui.locked) unlockedChats.clear();
  ui = { ...ui, ...next };
  applyTyping();
  if (document.body) {
    ensureInjected();
    applyDecor();
  }
});

ipcRenderer.on('tandem:request', async (_e, { rid, type, payload }) => {
  try {
    let result = null;
    if (type === 'send') result = await callMain('send', payload.chatId, payload.text);
    else if (type === 'edit') result = await callMain('edit', payload.id, payload.text);
    else if (type === 'note') result = await callMain('noteAction', payload.id, payload.action, payload.text || '');
    else if (type === 'focus-composer') result = focusComposer();
    else if (type === 'chat-list') result = await callMain('chatList');
    else if (type === 'forward') result = await callMain('forward', payload.msgId, payload.targetId);
    else if (type === 'open') result = await callMain('open', payload.chatId);
    else if (type === 'open-self') result = await callMain('openSelf');
    else if (type === 'pin-self') result = await callMain('pinSelf');
    ipcRenderer.send('tandem:response', { rid, ok: true, result });
  } catch (err) {
    ipcRenderer.send('tandem:response', { rid, ok: false, error: String((err && err.message) || err) });
  }
});

const navButtons = () => {
  const primary = [...document.querySelectorAll('[data-testid="navbar-primary-section"] button')];
  const footer = [...document.querySelectorAll('[data-testid="navbar-footer-section"] button')];
  return { primary, profile: footer[footer.length - 1] || null };
};

let statusItems = [];
let probing = false;

function readStatus() {
  const { primary, profile } = navButtons();
  let section = primary.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
  if (profile && profile.getAttribute('aria-pressed') === 'true') section = 9;
  const img = profile && profile.querySelector('img');
  return {
    loggedIn: !!document.getElementById('side') || primary.length > 0,
    section: section < 0 ? 0 : section,
    avatar: img && img.src ? img.src : null,
    unseenStatus: statusItems.length
  };
}

let last = '';
function report() {
  const status = readStatus();
  const json = JSON.stringify(status);
  if (json === last) return;
  last = json;
  ipcRenderer.send('tandem:status', status);
}

let scheduled = false;
function scheduleReport() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    report();
  }, 300);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(d) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function button(className, title, d, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.title = title;
  b.append(icon(d));
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

function canvasCopy(img) {
  try {
    if (!img.complete || !img.naturalWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 64, 64);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  }
}

const SAFE_URL = /^(data:image\/|https:\/\/[^/]*\.(whatsapp\.net|whatsapp\.com)\/)/;

function thumbnail(row) {
  const box = row.querySelector('[data-testid="status-thumbnail"]') || row;
  for (const el of box.querySelectorAll('[style*="background-image"]')) {
    const match = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    if (match && SAFE_URL.test(match[1])) return match[1];
  }
  const img = [...box.querySelectorAll('img')].find((i) => !/\/emoji/.test(i.src));
  if (!img) return null;
  if (img.src.startsWith('blob:')) return canvasCopy(img);
  return SAFE_URL.test(img.src) ? img.src : null;
}

function readStatusList() {
  const list = document.querySelector('[data-testid="status-list-drawer"], [data-testid="status-no-updates"]');
  if (!list) return false;
  const previous = new Map(statusItems.map((i) => [i.name, i.thumb]));
  statusItems = [...document.querySelectorAll('[data-testid="status-row-cell"]')]
    .filter((row) => row.querySelector('[data-testid="status-new-indication"]'))
    .map((row) => {
      const title = row.querySelector('[data-testid="cell-frame-title"]');
      const name = title ? title.textContent.trim() : '';
      const text = row.querySelector('[data-testid="status-text"]');
      return {
        name,
        thumb: thumbnail(row) || previous.get(name) || null,
        color: text ? getComputedStyle(text).backgroundColor : null
      };
    });
  scheduleReport();
  return true;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeStatus() {
  const active = document.activeElement;
  const typing = active && (active.isContentEditable || (active.tagName === 'INPUT' && active.value));
  if (probing || typing || document.getElementById('main')) return;
  const { primary } = navButtons();
  if (!primary[0] || !primary[2] || primary[0].getAttribute('aria-pressed') !== 'true') return;
  probing = true;
  document.documentElement.classList.add('wg-probing');
  try {
    primary[2].click();
    for (let i = 0; i < 30 && !readStatusList(); i++) await wait(100);
    for (let i = 0; i < 20; i++) {
      const imgs = [...document.querySelectorAll('[data-testid="status-row-cell"] img')];
      if (imgs.every((img) => img.complete)) break;
      await wait(150);
    }
    readStatusList();
  } finally {
    const chats = navButtons().primary[0];
    if (chats && chats.getAttribute('aria-pressed') !== 'true') chats.click();
    await wait(200);
    document.documentElement.classList.remove('wg-probing');
    probing = false;
  }
}

function statusButton() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'wg-status';
  b.title = tr('Статусы');
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const target = navButtons().primary[2];
    if (target) target.click();
  });
  return b;
}

function renderStatusButton(b) {
  const key = JSON.stringify(statusItems.slice(0, 3).map((i) => [i.name, !!i.thumb]));
  if (b.dataset.key === key) return;
  b.dataset.key = key;
  b.replaceChildren();
  b.classList.toggle('wg-unseen', statusItems.length > 0);
  if (!statusItems.length) {
    b.title = tr('Статусы');
    b.append(icon(STATUS));
    return;
  }
  b.title = tr('Новые статусы: ' + statusItems.map((i) => i.name).join(', '));
  for (const item of statusItems.slice(0, 3)) {
    const dot = document.createElement('span');
    dot.className = 'wg-story';
    if (item.thumb) dot.style.backgroundImage = 'url("' + item.thumb + '")';
    else {
      dot.style.background = item.color || '#5288c1';
      dot.textContent = (item.name[0] || '?').toUpperCase();
    }
    b.append(dot);
  }
}

const BURGER = 'M4 7h16M4 12h16M4 17h16';
const BACK = 'M15 5l-7 7 7 7';
const STATUS = 'M12 3a9 9 0 1 1-6.4 2.6M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z';
const CLOCK = 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z';

const hasTitle = (el, name) => [...el.querySelectorAll('svg title')].some((t) => t.textContent === name);
const composer = () => document.querySelector('#main footer [contenteditable="true"]');

function focusComposer() {
  const box = composer();
  if (!box) return false;
  box.focus();
  return true;
}

async function requestSchedule() {
  const box = composer();
  const text = box ? box.innerText.trim() : '';
  if (!text) return;
  const chat = await callMain('activeChat');
  if (!chat) return;
  ipcRenderer.send('tandem:schedule-request', { chatId: chat.id, chatName: chat.name, text });
}

function ensureComposerTools() {
  const footer = document.querySelector('#main footer');
  if (!footer) return;
  const box = composer();
  const pill = footer.querySelector('[data-testid="compose-box"] > span > div > div > div');
  let clock = footer.querySelector('.wg-schedule');
  if (clock && pill && clock.parentElement !== pill) {
    clock.remove();
    clock = null;
  }
  if (!clock && pill && pill.lastElementChild) {
    clock = button('wg-schedule', tr('Отправить позже'), CLOCK, requestSchedule);
    pill.insertBefore(clock, pill.lastElementChild);
  }
  if (clock) clock.classList.toggle('wg-visible', !!(box && box.innerText.trim()));
}

function ensureInjected() {
  const root = document.documentElement;
  checkLocale();
  if (ui.theme && root.dataset.wgTheme !== ui.theme) root.dataset.wgTheme = ui.theme;
  if (!root.style.getPropertyValue('--wg-saved')) root.style.setProperty('--wg-saved', JSON.stringify(tr('Избранное')));
  if (!probing && document.querySelector('[data-testid="status-list-drawer"], [data-testid="status-no-updates"]')) readStatusList();
  root.classList.toggle('wg-compact', !!ui.compact);
  root.classList.toggle('wg-no-filters', !!ui.hideFilters);
  const drawerRight = document.querySelector('[data-testid="drawer-right"]');
  root.classList.toggle('wg-drawer-open', !!(drawerRight && drawerRight.querySelector('header, button, [role="button"]')));
  const drawerMiddle = document.querySelector('[data-testid="drawer-middle"]');
  root.classList.toggle('wg-middle-open', !!(drawerMiddle && drawerMiddle.querySelector('header, button, [role="button"]')));
  root.classList.toggle('wg-blur', !!ui.blur);
  root.classList.toggle('wg-normal-density', ui.density === 'normal');
  root.classList.toggle('wg-favorite', !!ui.favoriteStyle);
  ensureFolders();
  ensureChatLock();
  ensureTemplates();

  const header = document.querySelector('[data-testid="conversation-header"]');
  if (header) {
    for (const b of header.querySelectorAll('button')) {
      if (hasTitle(b, 'ic-videocam')) b.classList.add('wg-video');
    }
  }
  ensureComposerTools();
  const headerTitle = header ? (header.querySelector('[data-testid="conversation-info-header-chat-title"]') || {}).textContent || '' : '';
  if (headerTitle !== lastHeaderTitle) {
    lastHeaderTitle = headerTitle;
    refreshSummary();
  }
  if (header) {
    const selfTitle = Object.keys(summary.kinds).find((k) => summary.kinds[k] === 'self');
    const isSelf = !!(selfTitle && summary.activeId && summary.ids[selfTitle] === summary.activeId);
    header.classList.toggle('wg-self-header', isSelf);
  }

  for (const stray of document.querySelectorAll('.wg-toolbar, .wg-has-status, .wg-burger, .wg-status')) {
    if (stray.closest('#side')) continue;
    if (stray.matches('.wg-burger, .wg-status')) stray.remove();
    else stray.classList.remove('wg-toolbar', 'wg-has-status', 'wg-has-stories');
  }
  const inChats = readStatus().section === 0;
  const search = inChats ? document.querySelector('#side [data-testid="chat-list-search-container"]') : null;
  const row = search && search.parentElement;
  if (!inChats) {
    document.querySelectorAll('.wg-burger, .wg-status').forEach((n) => n.remove());
    document.querySelectorAll('.wg-toolbar, .wg-has-status, .wg-has-stories').forEach((n) => n.classList.remove('wg-toolbar', 'wg-has-status', 'wg-has-stories'));
  }
  if (!ui.compact) {
    document.querySelectorAll('.wg-burger, .wg-status, .wg-back, .wg-section-back').forEach((n) => n.remove());
    if (row) row.classList.remove('wg-toolbar');
    if (search) search.classList.remove('wg-has-status');
    return;
  }

  if (row) {
    row.classList.add('wg-toolbar');
    if (!row.querySelector(':scope > .wg-burger')) row.prepend(button('wg-burger', tr('Меню'), BURGER, () => ipcRenderer.send('tandem:menu')));
    let status = search.querySelector(':scope > .wg-status');
    if (!status) {
      status = statusButton();
      search.append(status);
      search.classList.add('wg-has-status');
    }
    renderStatusButton(status);
    search.classList.toggle('wg-has-stories', statusItems.length > 0);
  }

  const section = readStatus().section;
  const titles = [...document.querySelectorAll('[data-testid="drawer-title-body"]')].filter((t) => t.getBoundingClientRect().width > 0);
  document.querySelectorAll('.wg-section-back').forEach((n) => {
    if (section === 0 || !titles.includes(n.nextElementSibling)) n.remove();
  });
  if (section !== 0) {
    for (const title of titles) {
      if (title.previousElementSibling && title.previousElementSibling.classList.contains('wg-section-back')) continue;
      title.parentElement.insertBefore(
        button('wg-back wg-section-back', tr('Назад к чатам'), BACK, () => {
          const chats = navButtons().primary[0];
          if (chats) chats.click();
        }),
        title
      );
    }
  }

  if (header && !header.querySelector(':scope > .wg-back')) {
    header.prepend(button('wg-back', tr('Назад (Esc)'), BACK, () => callMain('closeChat').catch(() => ipcRenderer.send('tandem:back'))));
  }
}

let summary = { counts: {}, kinds: {}, ids: {}, activeId: null };
let lastHeaderTitle = null;
let diagSent = false;
let localeChecked = false;

let localeTried = 0;

async function checkLocale() {
  if (localeChecked || ui.language === 'auto' || Date.now() - localeTried < 2000) return;
  localeTried = Date.now();
  const changed = await callMain('ensureLocale', I18N.lang === 'en' ? 'en' : 'ru_RU').catch(() => null);
  if (changed === null || changed === undefined) return;
  localeChecked = true;
  if (!changed) return;
  const lastReload = Number(sessionStorage.getItem('wg-locale-reload') || 0);
  if (Date.now() - lastReload < 60000) return;
  sessionStorage.setItem('wg-locale-reload', String(Date.now()));
  location.reload();
}

function applyDecor() {
  for (const tab of document.querySelectorAll('[aria-label="chat-list-filters"] button')) {
    const count = summary.counts[tab.id];
    const text = count > 999 ? '999+' : count ? String(count) : '';
    if ((tab.dataset.wgCount || '') !== text) {
      if (text) tab.dataset.wgCount = text;
      else delete tab.dataset.wgCount;
    }
  }
  for (const title of document.querySelectorAll('#pane-side [data-testid="cell-frame-title"]')) {
    const named = title.querySelector('[title]');
    const name = (named ? named.getAttribute('title') : title.textContent).trim();
    const kind = summary.kinds[name] || '';
    if ((title.dataset.wgKind || '') !== kind) {
      if (kind) title.dataset.wgKind = kind;
      else delete title.dataset.wgKind;
    }
    const cell = title.closest('[data-testid="cell-frame-container"], [data-testid="message-yourself-row"]');
    if (!cell) continue;
    const id = summary.ids[name] || '';
    if ((cell.dataset.wgChat || '') !== id) cell.dataset.wgChat = id;
    const lockedRow = ui.lockedChats.includes(id) ? '1' : '';
    if ((cell.dataset.wgLocked || '') !== lockedRow) {
      if (lockedRow) cell.dataset.wgLocked = lockedRow;
      else delete cell.dataset.wgLocked;
    }
    const selfRow = kind === 'self' ? '1' : '';
    if ((cell.dataset.wgSelf || '') !== selfRow) {
      if (selfRow) cell.dataset.wgSelf = selfRow;
      else delete cell.dataset.wgSelf;
    }
  }
}

async function refreshSummary() {
  if (document.hidden && !probing) return;
  if (!document.getElementById('side') && !document.getElementById('main')) return;
  try {
    const next = await callMain('summary');
    if (next) {
      summary = next;
      applyDecor();
      ensureChatLock();
      renderFolderList();
      applyTyping();
      checkLocale();
      if (!diagSent && document.getElementById('side')) {
        diagSent = true;
        runDiagnostics();
      }
    }
  } catch {}
}

let injectScheduled = false;
function scheduleInject() {
  if (injectScheduled) return;
  injectScheduled = true;
  setTimeout(() => {
    injectScheduled = false;
    ensureInjected();
    applyDecor();
    clampPopovers();
  }, 60);
}

const isPositioned = (el) => {
  const position = getComputedStyle(el).position;
  return position === 'absolute' || position === 'fixed';
};

function popoverBoxes() {
  const boxes = new Set();
  for (const root of document.querySelectorAll('#wa-popovers-bucket, #expressions-panel-container')) {
    for (const el of root.querySelectorAll('*')) {
      if (!isPositioned(el)) continue;
      let outer = true;
      for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
        if (isPositioned(a)) {
          outer = false;
          break;
        }
      }
      if (outer) boxes.add(el);
    }
  }
  for (const el of document.querySelectorAll('#app [role="menu"], #app [role="dialog"]')) {
    let box = el;
    while (box && box !== document.body && !isPositioned(box)) box = box.parentElement;
    if (box && box !== document.body) boxes.add(box);
  }
  return boxes;
}

const PANELS = '[data-testid="drawer-right"], [data-testid="drawer-left"], [data-testid="drawer-fullscreen"], #main, #side';

function resetFit(el) {
  if (!el.dataset.wgShift && !el.style.zoom && !el.style.maxHeight) return;
  delete el.dataset.wgShift;
  el.style.removeProperty('zoom');
  el.style.removeProperty('translate');
  el.style.removeProperty('max-height');
  el.style.removeProperty('overflow-y');
}

function clampPopovers() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const boxes = popoverBoxes();
  for (const el of document.querySelectorAll('[data-wg-shift]')) if (!boxes.has(el)) resetFit(el);
  for (const el of boxes) {
    if (el.closest(PANELS)) {
      resetFit(el);
      continue;
    }
    fitElement(el, 6, vw, vh);
  }
}

function fitElement(el, margin, vw, vh) {
  const zoom = parseFloat(el.style.zoom) || 1;
  const [px, py] = el.dataset.wgShift ? el.dataset.wgShift.split(',').map(Number) : [0, 0];
  let rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  if (zoom === 1 && Math.abs(rect.width - vw) <= 2 && Math.abs(rect.left) <= 1) return resetFit(el);
  const natural = rect.width / zoom;
  const nextZoom = natural > vw - margin * 2 ? Math.floor(((vw - margin * 2) / natural) * 995) / 1000 : 1;
  if (Math.abs(nextZoom - zoom) > 0.01) {
    if (nextZoom === 1) el.style.removeProperty('zoom');
    else el.style.setProperty('zoom', nextZoom.toFixed(3));
    rect = el.getBoundingClientRect();
  }
  const z = parseFloat(el.style.zoom) || 1;
  const fullPanel = rect.top <= 1 && rect.height >= vh - 1;
  if (!fullPanel && rect.height > vh - margin * 2) {
    el.style.setProperty('max-height', Math.floor((vh - margin * 2) / z) + 'px', 'important');
    el.style.setProperty('overflow-y', 'auto', 'important');
    rect = el.getBoundingClientRect();
  }
  const baseLeft = rect.left - px * z;
  const baseTop = rect.top - py * z;
  let dx = 0;
  let dy = 0;
  if (baseLeft < margin) dx = margin - baseLeft;
  else if (baseLeft + rect.width > vw - margin) dx = vw - margin - (baseLeft + rect.width);
  if (baseTop < margin) dy = margin - baseTop;
  else if (baseTop + rect.height > vh - margin && rect.height < vh) dy = vh - margin - (baseTop + rect.height);
  const sx = Math.round(dx / z);
  const sy = Math.round(dy / z);
  if (sx === px && sy === py) return;
  el.dataset.wgShift = sx + ',' + sy;
  if (sx || sy) el.style.setProperty('translate', sx + 'px ' + sy + 'px');
  else el.style.removeProperty('translate');
}

function onDoubleClick(e) {
  const row = e.target.closest && e.target.closest('#main [data-id]');
  if (!row || !row.querySelector('[data-testid="msg-container"]')) return;
  if (e.target.closest('a, button, input, textarea, [contenteditable="true"], [role="button"]')) return;
  const selection = window.getSelection();
  if (selection) selection.removeAllRanges();
  callMain('reply', row.getAttribute('data-id')).catch(() => {});
}

async function onKeyDown(e) {
  if (e.key !== 'ArrowUp' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const box = composer();
  if (!box || !box.contains(e.target) || box.innerText.trim()) return;
  e.preventDefault();
  e.stopPropagation();
  const target = await callMain('lastEditable').catch(() => null);
  if (target) ipcRenderer.send('tandem:edit-request', target);
}

async function runDiagnostics() {
  const checks = (await callMain('diagnostics').catch(() => null)) || { 'Мост к WhatsApp': false };
  Object.assign(checks, {
    'Список чатов (вёрстка)': !!document.querySelector('#pane-side'),
    'Панель разделов': navButtons().primary.length >= 3,
    'Поиск': !!document.querySelector('#side [data-testid="chat-list-search-container"]'),
    'Вкладки': !!document.querySelector('[aria-label="chat-list-filters"]') || !!ui.hideFilters
  });
  ipcRenderer.send('tandem:diag', checks);
}

const FOLDER_ICON = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';
let activeFolder = null;

function ensureFolders() {
  const tablist = document.querySelector('#side [aria-label="chat-list-filters"]');
  const anchor = tablist || (document.querySelector('#side [data-testid="chat-list-search-container"]') || {}).parentElement;
  let strip = document.querySelector('#side .wg-folders');
  if (!ui.folders.length) {
    if (strip) strip.remove();
    activeFolder = null;
    return;
  }
  if (!anchor || !anchor.parentElement) return;
  if (tablist && !tablist.dataset.wgBound) {
    tablist.dataset.wgBound = '1';
    tablist.addEventListener('click', () => {
      if (!activeFolder) return;
      activeFolder = null;
      ensureFolders();
      renderFolderList();
    });
  }
  if (!strip) {
    strip = document.createElement('div');
    strip.className = 'wg-folders';
    anchor.insertAdjacentElement('afterend', strip);
  } else if (strip.previousElementSibling !== anchor) {
    anchor.insertAdjacentElement('afterend', strip);
  }
  const key = JSON.stringify([ui.folders.map((f) => [f.id, f.name]), activeFolder]);
  if (strip.dataset.key === key) return;
  strip.dataset.key = key;
  strip.replaceChildren();
  for (const folder of ui.folders) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wg-folder' + (activeFolder === folder.id ? ' wg-active' : '');
    b.textContent = folder.name;
    b.title = tr('Правый клик — изменить');
    b.addEventListener('click', () => {
      activeFolder = activeFolder === folder.id ? null : folder.id;
      ensureFolders();
      renderFolderList();
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      ipcRenderer.send('tandem:page-modal', 'folder', { folderId: folder.id });
    });
    strip.append(b);
  }
  const add = button('wg-folder wg-folder-add', tr('Новая папка Tandem Chat'), FOLDER_ICON, () => ipcRenderer.send('tandem:page-modal', 'folder', {}));
  strip.append(add);
  if (activeFolder && !ui.folders.some((f) => f.id === activeFolder)) activeFolder = null;
}

let folderRows = [];
async function renderFolderList() {
  const pane = document.getElementById('pane-side');
  let overlay = document.querySelector('#side .wg-folder-list');
  const folder = ui.folders.find((f) => f.id === activeFolder);
  document.documentElement.classList.toggle('wg-folder-open', !!(folder && pane));
  if (!folder || !pane) {
    if (overlay) overlay.remove();
    return;
  }
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'wg-folder-list';
    pane.parentElement.insertBefore(overlay, pane);
  }
  const all = (await callMain('chatList').catch(() => null)) || folderRows;
  folderRows = all;
  const rows = all.filter((c) => folder.chatIds.includes(c.id));
  const key = JSON.stringify(rows.map((r) => [r.id, r.unread, r.preview, r.t, r.pic, summary.activeId === r.id]));
  if (overlay.dataset.key === key) return;
  overlay.dataset.key = key;
  overlay.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'wg-folder-empty';
    empty.textContent = tr('В папке пока нет чатов. Правый клик по названию папки — изменить.');
    overlay.append(empty);
    return;
  }
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'wg-folder-row' + (summary.activeId === r.id ? ' wg-active' : '') + (ui.lockedChats.includes(r.id) ? ' wg-locked' : '');
    const avatar = document.createElement('div');
    avatar.className = 'wg-folder-avatar';
    const favorite = r.self && ui.favoriteStyle;
    if (favorite) avatar.classList.add('wg-fav');
    else if (r.pic) avatar.style.backgroundImage = 'url("' + r.pic + '")';
    else avatar.textContent = (r.title[0] || '?').toUpperCase();
    const body = document.createElement('div');
    body.className = 'wg-folder-body';
    const top = document.createElement('div');
    top.className = 'wg-folder-top';
    const name = document.createElement('span');
    name.className = 'wg-folder-name';
    name.textContent = favorite ? tr('Избранное') : r.title;
    if (r.kind !== 'user') name.dataset.wgKind = r.kind;
    const time = document.createElement('span');
    time.className = 'wg-folder-time';
    time.textContent = r.t ? new Date(r.t * 1000).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';
    top.append(name, time);
    const bottom = document.createElement('div');
    bottom.className = 'wg-folder-bottom';
    const preview = document.createElement('span');
    preview.className = 'wg-folder-preview';
    preview.textContent = r.preview;
    bottom.append(preview);
    if (r.unread) {
      const badge = document.createElement('span');
      badge.className = 'wg-folder-badge' + (r.muted ? ' wg-muted' : '');
      badge.textContent = String(r.unread);
      bottom.append(badge);
    }
    body.append(top, bottom);
    row.append(avatar, body);
    row.dataset.wgChat = r.id;
    row.addEventListener('click', () => callMain('open', r.id).catch(() => {}));
    overlay.append(row);
  }
}

function ensureChatLock() {
  const main = document.getElementById('main');
  const id = summary.activeId;
  const lockedNow = !!(main && id && ui.lockedChats.includes(id) && !unlockedChats.has(id));
  document.documentElement.classList.toggle('wg-chat-locked', lockedNow);
  let gate = main && main.querySelector(':scope > .wg-chat-gate');
  if (!lockedNow) {
    if (gate) gate.remove();
    return;
  }
  if (gate && gate.dataset.chat === id) return;
  if (gate) gate.remove();
  gate = document.createElement('form');
  gate.className = 'wg-chat-gate';
  gate.dataset.chat = id;
  const title = document.createElement('div');
  title.className = 'wg-gate-title';
  title.textContent = tr('Чат защищён код-паролем');
  const input = document.createElement('input');
  input.type = 'password';
  input.placeholder = tr('Код-пароль Tandem Chat');
  input.autocomplete = 'off';
  const error = document.createElement('div');
  error.className = 'wg-gate-error';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = tr('Открыть');
  gate.append(title, input, error, submit);
  gate.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await ipcRenderer.invoke('tandem:unlock-chat', input.value);
    input.value = '';
    if (res && res.ok) {
      unlockedChats.add(id);
      ensureChatLock();
      applyDecor();
    } else error.textContent = (res && res.error) || tr('Неверный код-пароль');
  });
  main.append(gate);
  setTimeout(() => input.focus(), 50);
}

let templateBar = null;
function ensureTemplates() {
  const footer = document.querySelector('#main footer');
  const box = composer();
  const text = box ? box.innerText.trim() : '';
  const matches = text.startsWith('/') && !/\s/.test(text) && ui.templates.length ? ui.templates.filter((t) => t.key.toLowerCase().startsWith(text.slice(1).toLowerCase())).slice(0, 6) : [];
  if (!footer || !matches.length) {
    if (templateBar) templateBar.remove();
    templateBar = null;
    return;
  }
  const key = JSON.stringify(matches.map((m) => m.key));
  if (templateBar && templateBar.isConnected && templateBar.dataset.key === key) return;
  if (templateBar) templateBar.remove();
  templateBar = document.createElement('div');
  templateBar.className = 'wg-templates';
  templateBar.dataset.key = key;
  for (const m of matches) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'wg-template';
    const k = document.createElement('b');
    k.textContent = '/' + m.key;
    const t = document.createElement('span');
    t.textContent = m.text.length > 60 ? m.text.slice(0, 60) + '…' : m.text;
    chip.append(k, t);
    chip.addEventListener('mousedown', (e) => e.preventDefault());
    chip.addEventListener('click', () => applyTemplate(m));
    templateBar.append(chip);
  }
  footer.append(templateBar);
}

function applyTemplate(m) {
  const box = composer();
  if (box) box.focus();
  ipcRenderer.send('tandem:template-apply', m.text);
  if (templateBar) templateBar.remove();
  templateBar = null;
}

let hoverBar = null;
let hoverRow = null;
const STAR = 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z';
const SHARE = 'M14 5l7 7-7 7M21 12H9a6 6 0 0 0-6 6';
const BELL = 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0';

async function messageAction(action) {
  if (!hoverRow) return;
  const info = await callMain('msgInfo', hoverRow.getAttribute('data-id')).catch(() => null);
  if (!info) return;
  if (action === 'save') {
    if (!info.forwardable) return flash(tr('В Избранное пока сохраняется только текст и подписи'));
    const ok = await callMain('forward', info.id, 'self').then(() => true, (err) => flash(String(err.message || err)));
    if (ok) flash(tr('Сохранено в Избранное'));
  } else if (action === 'forward') {
    if (!info.forwardable) return flash(tr('Без подписи пока пересылается только текст и подписи'));
    ipcRenderer.send('tandem:page-modal', 'forward', { msgId: info.id, text: info.text });
  } else if (action === 'remind') {
    ipcRenderer.send('tandem:page-modal', 'remind', { chatId: info.chatId, chatName: info.chatName, text: info.text });
  }
}

function flash(text) {
  let toast = document.querySelector('.wg-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'wg-toast';
    document.body.append(toast);
  }
  toast.textContent = text;
  toast.classList.add('wg-show');
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => toast.classList.remove('wg-show'), 2200);
  return false;
}

function onMessageHover(e) {
  const row = e.target.closest && e.target.closest('#main [data-id]');
  if (row && hoverBar && hoverBar.contains(e.target)) return;
  if (!row || !row.querySelector('[data-testid="msg-container"]')) {
    if (hoverBar && !(e.target.closest && e.target.closest('.wg-msg-actions'))) hoverBar.classList.remove('wg-show');
    return;
  }
  if (!hoverBar) {
    hoverBar = document.createElement('div');
    hoverBar.className = 'wg-msg-actions';
    hoverBar.append(
      button('wg-msg-btn', tr('В Избранное'), STAR, () => messageAction('save')),
      button('wg-msg-btn', tr('Переслать без подписи'), SHARE, () => messageAction('forward')),
      button('wg-msg-btn', tr('Напомнить'), BELL, () => messageAction('remind'))
    );
    document.body.append(hoverBar);
  }
  hoverRow = row;
  const bubble = row.querySelector('[data-testid="msg-container"]').getBoundingClientRect();
  const main = document.getElementById('main').getBoundingClientRect();
  const outgoing = bubble.right > main.right - 40;
  const side = outgoing ? bubble.left - 104 : bubble.right + 6;
  const fitsBeside = side >= main.left + 4 && side + 100 <= main.right - 4;
  const x = fitsBeside ? side : outgoing ? bubble.right - 100 : bubble.left;
  const y = fitsBeside ? bubble.top : bubble.top - 38;
  hoverBar.style.left = Math.max(main.left + 4, Math.min(x, main.right - 104)) + 'px';
  hoverBar.style.top = Math.max(main.top + 56, y) + 'px';
  hoverBar.classList.add('wg-show');
}

let previewCard = null;
function closePreview() {
  if (previewCard) previewCard.remove();
  previewCard = null;
}

async function onListClick(e) {
  if (previewCard && !previewCard.contains(e.target)) closePreview();
  if (!e.altKey) return;
  const cell = e.target.closest && e.target.closest('#pane-side [data-testid="cell-frame-container"], #pane-side [data-testid="message-yourself-row"]');
  if (!cell || !cell.dataset.wgChat) return;
  e.preventDefault();
  e.stopPropagation();
  const id = cell.dataset.wgChat;
  if (ui.lockedChats.includes(id) && !unlockedChats.has(id)) return flash(tr('Чат защищён код-паролем'));
  const data = await callMain('preview', id).catch(() => null);
  if (!data) return;
  closePreview();
  previewCard = document.createElement('div');
  previewCard.className = 'wg-preview';
  const head = document.createElement('div');
  head.className = 'wg-preview-head';
  head.textContent = data.title;
  const list = document.createElement('div');
  list.className = 'wg-preview-list';
  for (const m of data.messages) {
    const bubble = document.createElement('div');
    bubble.className = 'wg-preview-msg' + (m.fromMe ? ' wg-out' : '');
    if (m.author) {
      const a = document.createElement('b');
      a.textContent = m.author;
      bubble.append(a);
    }
    const t = document.createElement('span');
    t.textContent = m.text;
    bubble.append(t);
    list.append(bubble);
  }
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'wg-preview-open';
  open.textContent = tr('Открыть чат');
  open.addEventListener('click', () => {
    closePreview();
    callMain('open', id).catch(() => {});
  });
  previewCard.append(head, list, open);
  document.body.append(previewCard);
  const rect = cell.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - 16);
  previewCard.style.width = width + 'px';
  previewCard.style.left = Math.min(rect.right + 8, window.innerWidth - width - 8) + 'px';
  previewCard.style.top = Math.max(8, Math.min(rect.top, window.innerHeight - 420)) + 'px';
  list.scrollTop = list.scrollHeight;
}

function onSendContextMenu(e) {
  const footer = document.querySelector('#main footer');
  const target = e.target.closest && e.target.closest('button');
  if (!footer || !target || !footer.contains(target)) return;
  const pill = footer.querySelector('[data-testid="compose-box"] > span > div > div > div');
  if (!pill || !pill.lastElementChild || !pill.lastElementChild.contains(target)) return;
  const box = composer();
  if (!box || !box.innerText.trim()) return;
  e.preventDefault();
  e.stopPropagation();
  requestSchedule();
}

let dropRow = null;

function chatRowAt(target) {
  if (!target || !target.closest) return null;
  const row = target.closest('#pane-side [data-wg-chat], .wg-folder-list [data-wg-chat]');
  if (row && row.dataset.wgChat) return row;
  const main = target.closest('#main');
  return main && main.querySelector('footer') ? main : null;
}

function setDropRow(row) {
  if (dropRow === row) return;
  if (dropRow) dropRow.classList.remove('wg-drop-target');
  dropRow = row;
  if (dropRow) dropRow.classList.add('wg-drop-target');
}

const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

function onDragOver(e) {
  if (!hasFiles(e)) return;
  const row = chatRowAt(e.target);
  setDropRow(row);
  if (!row) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'copy';
}

async function onDrop(e) {
  if (!hasFiles(e)) return;
  const row = chatRowAt(e.target);
  setDropRow(null);
  if (!row) return;
  e.preventDefault();
  e.stopPropagation();
  const id = row.dataset.wgChat || '';
  if (id && ui.lockedChats.includes(id) && !unlockedChats.has(id)) return flash(tr('Чат защищён код-паролем — сначала откройте его'));
  const files = [...e.dataTransfer.files];
  if (!files.length) return;
  let holder = document.getElementById('wg-drop-holder');
  if (!holder) {
    holder = document.createElement('input');
    holder.type = 'file';
    holder.multiple = true;
    holder.id = 'wg-drop-holder';
    holder.hidden = true;
    document.body.append(holder);
  }
  const transfer = new DataTransfer();
  for (const f of files) transfer.items.add(f);
  holder.files = transfer.files;
  try {
    await callMain('dropFiles', id);
  } catch (err) {
    flash(String((err && err.message) || err));
  }
}

function onTemplateKey(e) {
  if (e.key !== 'Tab' || !templateBar || e.shiftKey || e.ctrlKey || e.altKey) return;
  const box = composer();
  if (!box || !box.contains(e.target)) return;
  const first = templateBar.querySelector('.wg-template');
  if (!first) return;
  e.preventDefault();
  e.stopPropagation();
  first.click();
}

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('mouseover', onMessageHover, true);
  const hideHoverBar = () => hoverBar && hoverBar.classList.remove('wg-show');
  document.documentElement.addEventListener('mouseleave', hideHoverBar);
  document.addEventListener('scroll', (e) => {
    if (!hoverBar || !hoverBar.contains(e.target)) hideHoverBar();
  }, true);
  window.addEventListener('blur', hideHoverBar);
  document.addEventListener('click', onListClick, true);
  document.addEventListener('keydown', onTemplateKey, true);
  document.addEventListener('contextmenu', onSendContextMenu, true);
  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('dragenter', onDragOver, true);
  document.addEventListener('drop', onDrop, true);
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !chatRowAt(e.relatedTarget)) setDropRow(null);
  }, true);
  document.addEventListener('dragend', () => setDropRow(null), true);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closePreview(), true);
  new MutationObserver(scheduleReport).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'src'] });
  new MutationObserver(scheduleInject).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', scheduleInject);
  document.addEventListener('input', scheduleInject, true);
  document.addEventListener('dblclick', onDoubleClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  setInterval(refreshSummary, 2000);
  report();
  ensureInjected();
});

ipcRenderer.on('tandem:probe-status', () => {
  probeStatus().catch(() => {});
});

ipcRenderer.on('tandem:open-section', (_e, index) => {
  const { primary, profile } = navButtons();
  const target = index === 9 ? profile : primary[index];
  if (target) target.click();
});

async function mainMenuAction(iconName) {
  const { primary } = navButtons();
  if (primary[0] && primary[0].getAttribute('aria-pressed') !== 'true') {
    primary[0].click();
    await wait(300);
  }
  const header = document.getElementById('side') && document.getElementById('side').parentElement.querySelector('header');
  const menuButton = header ? header.querySelector('button') : null;
  if (!menuButton) return;
  document.documentElement.classList.add('wg-ghost-menu');
  try {
    menuButton.click();
    let item = null;
    for (let i = 0; i < 20 && !item; i++) {
      await wait(80);
      item = [...document.querySelectorAll('[role=menu] [role=menuitem]')].find((m) => hasTitle(m, iconName));
    }
    if (item) item.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  } finally {
    await wait(150);
    document.documentElement.classList.remove('wg-ghost-menu');
  }
}

ipcRenderer.on('tandem:action', (_e, action) => {
  if (typeof action === 'string' && action.startsWith('menu:')) {
    mainMenuAction(action.slice(5)).catch(() => {});
    return;
  }
  if (action === 'archive') {
    const { primary } = navButtons();
    if (primary[0] && primary[0].getAttribute('aria-pressed') !== 'true') primary[0].click();
    setTimeout(() => {
      const archived = document.querySelector('[data-testid="chatlist-panel-archived-button"]');
      if (archived) archived.click();
    }, 150);
  } else if (action === 'new-chat') {
    const header = document.getElementById('side') && document.getElementById('side').parentElement.querySelector('header');
    const buttons = header ? [...header.querySelectorAll('button')] : [];
    const target = buttons[buttons.length - 1];
    if (target) target.click();
  }
});
