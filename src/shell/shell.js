const api = window.shell;
const $ = (id) => document.getElementById(id);

const I18N = api.i18n || { lang: 'ru', EN: {}, PATTERNS: [] };
const EN_UI = I18N.lang === 'en';
const LOCALE = EN_UI ? 'en-US' : 'ru-RU';
const PATTERNS = I18N.PATTERNS.map(([source, out]) => [new RegExp(source), out]);
document.documentElement.lang = I18N.lang;

function t(text) {
  if (!EN_UI || typeof text !== 'string' || !text) return text;
  if (Object.prototype.hasOwnProperty.call(I18N.EN, text)) return I18N.EN[text];
  const trimmed = text.trim();
  if (trimmed !== text && Object.prototype.hasOwnProperty.call(I18N.EN, trimmed)) return text.replace(trimmed, I18N.EN[trimmed]);
  for (const [re, out] of PATTERNS) if (re.test(trimmed)) return text.replace(trimmed, trimmed.replace(re, out));
  return text;
}

function translateNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (node.parentElement && node.parentElement.closest('.no-tr')) return;
    const next = t(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || node.closest('.no-tr')) return;
  for (const attr of ['title', 'placeholder']) {
    if (!node.hasAttribute(attr)) continue;
    const next = t(node.getAttribute(attr));
    if (next !== node.getAttribute(attr)) node.setAttribute(attr, next);
  }
}

function translateTree(root) {
  if (!EN_UI) return;
  translateNode(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) translateNode(node);
}

if (EN_UI) {
  translateTree(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(translateTree);
      else translateNode(r.target);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
}

function count(n, ru, en) {
  if (EN_UI) return n + ' ' + (n === 1 ? en[0] : en[1]);
  return plural(n, ...ru);
}

const ICONS = {
  chats: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  calls: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  status: '<circle cx="12" cy="12" r="9" stroke-dasharray="4 2.5"/><circle cx="12" cy="12" r="4"/>',
  channels: '<path d="M3 11v3a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  communities: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.2A5 5 0 0 1 21.5 19"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
};

const SECTIONS = [
  { index: 0, label: 'Чаты', icon: 'chats', key: 'Ctrl+1' },
  { index: 1, label: 'Звонки', icon: 'calls', key: 'Ctrl+2' },
  { index: 2, label: 'Статус', icon: 'status', key: 'Ctrl+3' },
  { index: 3, label: 'Каналы', icon: 'channels', key: 'Ctrl+4' },
  { index: 4, label: 'Сообщества', icon: 'communities', key: 'Ctrl+5' },
  { index: 9, label: 'Профиль', icon: 'profile', key: '' }
];

let state = null;
let lastBadge = -1;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

function svg(name) {
  const wrap = document.createElement('span');
  wrap.className = 'icon';
  wrap.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
  return wrap;
}

function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

function avatar(account, size) {
  const node = el('span', { class: 'avatar no-tr' });
  Object.assign(node.style, { background: account.color, width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` });
  if (account.avatar) {
    const img = el('img', { src: account.avatar, alt: '' });
    img.addEventListener('error', () => img.remove());
    node.append(img);
  }
  node.append(el('span', { class: 'initials', text: initials(account.name) }));
  return node;
}

function badge(count) {
  if (!count) return null;
  return el('span', { class: 'badge', text: count > 99 ? '99+' : String(count) });
}

function renderRail() {
  const accounts = $('accounts');
  accounts.replaceChildren(
    ...state.accounts.map((a, i) =>
      el(
        'button',
        {
          class: 'account no-tr' + (a.id === state.activeId ? ' active' : ''),
          title: `${a.name}${i < 9 ? `  (Ctrl+Shift+${i + 1})` : ''}`,
          onclick: () => api.activate(a.id),
          oncontextmenu: (e) => {
            e.preventDefault();
            api.activate(a.id);
            api.openModal('settings');
          }
        },
        [avatar(a, 42), badge(a.unread)]
      )
    )
  );

  const active = state.accounts.find((a) => a.id === state.activeId);
  const current = active ? active.section : 0;
  $('sections').replaceChildren(
    ...SECTIONS.map((s) =>
      el(
        'button',
        {
          class: 'section' + (s.index === current ? ' active' : ''),
          title: s.key ? `${t(s.label)} (${s.key})` : t(s.label),
          disabled: active && !active.loggedIn,
          onclick: () => api.openSection(s.index)
        },
        [svg(s.icon), el('span', { class: 'label', text: s.label }), s.index === 0 && active ? badge(active.unread) : null, s.index === 2 && active && active.unseenStatus ? el('span', { class: 'dot', title: 'Новые статусы' }) : null]
      )
    )
  );

  $('lock-btn').title = state.hasPasscode ? 'Заблокировать (Ctrl+L)' : 'Установить код-пароль';
  $('lock-btn').classList.toggle('dim', !state.hasPasscode);
}

function renderLock() {
  const screen = $('lock-screen');
  const wasHidden = screen.hidden;
  screen.hidden = !state.locked;
  if (state.locked && wasHidden) {
    $('modal').hidden = true;
    $('lock-input').value = '';
    $('lock-error').textContent = '';
    setTimeout(() => $('lock-input').focus(), 50);
  }
  if (state.lockoutSeconds > 0) $('lock-error').textContent = t(`Слишком много попыток. Подождите ${state.lockoutSeconds} с.`);
}

let trayBase = null;

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function trayImage(count, size, dot) {
  if (!trayBase) {
    const urls = await api.trayBase();
    trayBase = { 16: await loadImage(urls.x1), 32: await loadImage(urls.x2) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (trayBase[size]) ctx.drawImage(trayBase[size], 0, 0, size, size);
  if (dot) {
    const r = size * 0.24;
    ctx.beginPath();
    ctx.arc(size - r - size / 32, size - r - size / 32, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e53935';
    ctx.fill();
    ctx.lineWidth = Math.max(1, size / 16);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.stroke();
    return canvas.toDataURL('image/png');
  }
  const text = count > 99 ? '99+' : String(count);
  const h = Math.round(size * 0.62);
  ctx.font = `bold ${Math.round(h * 0.82)}px "Segoe UI", sans-serif`;
  const w = Math.max(h, Math.ceil(ctx.measureText(text).width + size * 0.22));
  const x = size - w;
  const y = size - h;
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = '#e53935';
  ctx.fill();
  ctx.lineWidth = Math.max(1, size / 16);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + size / 32);
  return canvas.toDataURL('image/png');
}

async function drawTaskbarBadge(count, style) {
  const key = style + ':' + count;
  if (key === lastBadge) return;
  lastBadge = key;
  if (!count || style === 'none') return api.badge(null, 0, null, null);
  const dot = style === 'dot';
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e53935';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, dot ? size / 3 : size / 2, 0, Math.PI * 2);
  ctx.fill();
  if (!dot) {
    const text = count > 99 ? '99+' : String(count);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${text.length > 2 ? 12 : text.length > 1 ? 16 : 20}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + 1);
  }
  const overlay = canvas.toDataURL('image/png');
  const [tray1, tray2] = await Promise.all([trayImage(count, 16, dot), trayImage(count, 32, dot)]);
  if (key === lastBadge) api.badge(overlay, count, tray1, tray2);
}

let currentModal = null;

function closeModal() {
  $('modal').hidden = true;
  currentModal = null;
  api.closeModal();
}

function field(label, input) {
  return el('label', { class: 'field' }, [el('span', { text: label }), input]);
}

function modalShell(title, body, actions, autofocus = true) {
  const parts = [
    el('header', {}, [el('h2', { text: title }), el('button', { class: 'close', title: 'Закрыть (Esc)', onclick: closeModal, text: '×' })]),
    el('div', { class: 'modal-content' }, body)
  ];
  if (actions) parts.push(el('footer', {}, actions));
  currentModal = title === 'Настройки Tandem Chat' ? 'settings' : 'dialog';
  $('modal').classList.remove('drawer-mode');
  $('modal-body').className = 'modal';
  $('modal-body').replaceChildren(...parts);
  $('modal').hidden = false;
  const first = autofocus && $('modal-body').querySelector('input');
  if (first) setTimeout(() => first.focus(), 50);
}

function addAccountModal() {
  const name = el('input', { type: 'text', placeholder: `Аккаунт ${state.accounts.length + 1}`, maxlength: 40 });
  const submit = () => {
    api.addAccount(name.value.trim());
    closeModal();
  };
  name.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  modalShell(
    'Новый аккаунт',
    [
      el('p', { class: 'muted', text: 'Для каждого аккаунта своя сессия. После добавления отсканируйте QR-код телефоном с этим номером.' }),
      field('Название', name)
    ],
    [el('button', { class: 'ghost', text: 'Отмена', onclick: closeModal }), el('button', { class: 'primary', text: 'Добавить', onclick: submit })]
  );
}

function passcodeModal() {
  const current = el('input', { type: 'password', placeholder: 'Текущий код-пароль', autocomplete: 'off' });
  const next = el('input', { type: 'password', placeholder: 'Новый код-пароль', autocomplete: 'off' });
  const repeat = el('input', { type: 'password', placeholder: 'Повторите', autocomplete: 'off' });
  const error = el('p', { class: 'error' });

  const save = async () => {
    if (next.value.length < 4) return (error.textContent = 'Минимум 4 символа');
    if (next.value !== repeat.value) return (error.textContent = 'Код-пароли не совпадают');
    const res = await api.setPasscode(current.value, next.value);
    if (!res.ok) return (error.textContent = res.error || 'Не удалось сохранить');
    settingsModal();
  };
  const remove = async () => {
    const res = await api.setPasscode(current.value, null);
    if (!res.ok) return (error.textContent = res.error || 'Не удалось отключить');
    settingsModal();
  };
  for (const input of [current, next, repeat]) input.addEventListener('keydown', (e) => e.key === 'Enter' && save());

  modalShell(
    state.hasPasscode ? 'Изменить код-пароль' : 'Код-пароль',
    [
      el('p', { class: 'muted', text: 'Код-пароль закрывает Tandem Chat на этом компьютере. Пока приложение заблокировано, уведомления приходят без текста.' }),
      state.hasPasscode ? field('Текущий', current) : null,
      field('Новый', next),
      field('Ещё раз', repeat),
      error
    ],
    [
      state.hasPasscode ? el('button', { class: 'danger', text: 'Отключить', onclick: remove }) : null,
      el('span', { class: 'grow' }),
      el('button', { class: 'ghost', text: 'Назад', onclick: settingsModal }),
      el('button', { class: 'primary', text: 'Сохранить', onclick: save })
    ]
  );
}

function removeAccountModal(account) {
  modalShell(
    'Удалить аккаунт?',
    [el('p', { text: `«${account.name}» будет удалён из Tandem Chat вместе с локальной сессией. Сам аккаунт WhatsApp и переписка на телефоне останутся.` })],
    [
      el('button', { class: 'ghost', text: 'Отмена', onclick: settingsModal }),
      el('button', {
        class: 'danger',
        text: 'Удалить',
        onclick: () => {
          api.removeAccount(account.id);
          settingsModal();
        }
      })
    ]
  );
}

let lastBackupStatus = '';

function settingsModal() {
  const themeRow = el(
    'div',
    { class: 'choices' },
    Object.entries(state.themes).map(([id, label]) =>
      el('button', { class: 'choice' + (state.theme === id ? ' active' : ''), text: label, onclick: () => api.setTheme(id) })
    )
  );

  const accountsList = el(
    'div',
    { class: 'account-list' },
    state.accounts.map((a) => {
      const name = el('input', { type: 'text', value: a.name, maxlength: 40 });
      name.addEventListener('change', () => api.renameAccount(a.id, name.value));
      return el('div', { class: 'account-row' }, [
        avatar(a, 32),
        name,
        el('span', { class: 'muted small', text: a.loggedIn ? 'подключён' : 'не вошёл' }),
        el(
          'select',
          { class: 'sound', title: 'Звук уведомлений', onchange: (e) => { api.setAccountSound(a.id, e.target.value); playSound(e.target.value); } },
          [
            ['note', '♪ Нота'],
            ['bell', '♫ Колокол'],
            ['drop', '• Капля'],
            ['none', 'Без звука']
          ].map(([v, t]) => el('option', { value: v, text: t, selected: (a.sound || 'note') === v }))
        ),
        el('button', { class: 'icon-btn', title: 'Прослушать звук', text: '▶', onclick: () => playSound(a.sound || 'note') }),
        el('button', {
          class: 'icon-btn bell' + (a.muted ? ' off' : ''),
          title: a.muted ? 'Уведомления выключены — включить' : 'Выключить уведомления этого аккаунта',
          text: a.muted ? '🔕' : '🔔',
          onclick: () => api.setAccountMuted(a.id, !a.muted)
        }),
        state.accounts.length > 1 ? el('button', { class: 'icon-btn', title: 'Удалить', text: '🗑', onclick: () => removeAccountModal(a) }) : null
      ]);
    })
  );

  const autolock = el(
    'select',
    { disabled: !state.hasPasscode, onchange: (e) => api.setAutoLock(Number(e.target.value)) },
    [
      [0, 'Никогда'],
      [1, 'Через 1 минуту'],
      [5, 'Через 5 минут'],
      [15, 'Через 15 минут'],
      [60, 'Через 1 час']
    ].map(([v, t]) => el('option', { value: v, text: t, selected: state.autoLockMinutes === v }))
  );

  const autostart = el('input', { type: 'checkbox', checked: state.autostart, onchange: (e) => api.setAutostart(e.target.checked) });
  const themeMode = el(
    'select',
    { onchange: (e) => api.setSetting('themeMode', e.target.value) },
    [
      ['manual', 'Вручную'],
      ['system', 'Как в Windows'],
      ['schedule', 'По расписанию']
    ].map(([v, t]) => el('option', { value: v, text: t, selected: state.themeMode === v }))
  );
  const nightFrom = el('input', { type: 'time', value: (state.themeSchedule || {}).from || '20:00', class: 'time' });
  const nightTo = el('input', { type: 'time', value: (state.themeSchedule || {}).to || '08:00', class: 'time' });
  const saveNight = () => api.setSetting('themeSchedule', { from: nightFrom.value || '20:00', to: nightTo.value || '08:00' });
  nightFrom.addEventListener('change', saveNight);
  nightTo.addEventListener('change', saveNight);

  const density = el(
    'select',
    { onchange: (e) => api.setSetting('density', e.target.value) },
    [
      ['compact', 'Компактный'],
      ['normal', 'Обычный']
    ].map(([v, t]) => el('option', { value: v, text: t, selected: state.density === v }))
  );
  const zoomValue = el('span', { class: 'muted small', text: Math.round((state.zoom || 1) * 100) + '%' });
  const zoom = el('input', { type: 'range', min: 70, max: 150, step: 5, value: Math.round((state.zoom || 1) * 100), class: 'range' });
  zoom.addEventListener('input', () => (zoomValue.textContent = zoom.value + '%'));
  zoom.addEventListener('change', () => api.setSetting('zoom', Number(zoom.value) / 100));
  const favorite = el('input', { type: 'checkbox', checked: !!state.favoriteStyle, onchange: (e) => api.setSetting('favoriteStyle', e.target.checked) });
  const blur = el('input', { type: 'checkbox', checked: !!state.blur, onchange: (e) => api.setSetting('blur', e.target.checked) });
  const hideTyping = el('input', { type: 'checkbox', checked: !!state.hideTyping, onchange: (e) => api.setSetting('hideTyping', e.target.checked) });
  const globalHotkey = el('input', { type: 'checkbox', checked: !!state.globalHotkey, onchange: (e) => api.setSetting('globalHotkey', e.target.checked) });

  const templatesBox = templatesEditor();

  const foldersList = state.folders.length
    ? el(
        'div',
        { class: 'scheduled' },
        state.folders.map((f) =>
          el('div', { class: 'scheduled-row' }, [
            el('div', { class: 'scheduled-main' }, [el('div', { class: 'scheduled-head no-tr', text: f.name }), el('div', { class: 'muted small', text: count(f.chatIds.length, ['чат', 'чата', 'чатов'], ['chat', 'chats']) })]),
            el('button', { class: 'icon-btn', title: 'Изменить', text: '✎', onclick: () => folderModal({ folderId: f.id, accountId: state.activeId }) })
          ])
        )
      )
    : el('p', { class: 'muted small', text: 'Папок пока нет.' });

  const remindersList = state.reminders.length
    ? el(
        'div',
        { class: 'scheduled' },
        state.reminders.map((r) =>
          el('div', { class: 'scheduled-row' }, [
            el('div', { class: 'scheduled-main' }, [el('div', { class: 'scheduled-head no-tr', text: `${r.chatName || t('Чат')} · ${formatWhen(r.at)}` }), el('div', { class: 'muted small ellipsis no-tr', text: r.text })]),
            el('button', { class: 'icon-btn', title: 'Отменить', text: '✕', onclick: () => api.reminderCancel(r.id) })
          ])
        )
      )
    : el('p', { class: 'muted small', text: 'Нет. Наведите мышь на сообщение и нажмите 🔔.' });

  const diagRows = [];
  for (const account of state.diag || []) {
    if (!account.checks) continue;
    const broken = Object.entries(account.checks).filter(([, ok]) => !ok).map(([name]) => name);
    diagRows.push(
      el('div', { class: 'row' }, [
        el('span', { text: state.diag.length > 1 ? account.name : 'WhatsApp Web' }),
        el('span', { class: broken.length ? 'error' : 'ok', text: broken.length ? t('Не работает: ' + broken.map(t).join(', ')) : 'Всё в порядке' })
      ])
    );
  }

  const backupStatus = el('p', { class: 'muted small', text: lastBackupStatus });

  const showFilters = el('input', { type: 'checkbox', checked: !state.hideFilters, onchange: (e) => api.setSetting('hideFilters', !e.target.checked) });

  const noteStyle = el(
    'select',
    { onchange: (e) => api.setSetting('notifyStyle', e.target.value) },
    [
      ['app', 'Tandem Chat, с быстрым ответом'],
      ['system', 'Системные Windows']
    ].map(([v, t]) => el('option', { value: v, text: t, selected: state.notifyStyle === v }))
  );

  const uiLanguage = el(
    'select',
    { class: 'no-tr', onchange: (e) => api.setSetting('uiLanguage', e.target.value) },
    [
      ['ru', 'Русский'],
      ['en', 'English']
    ].map(([v, label]) => el('option', { value: v, text: label, selected: state.uiLanguage === v }))
  );

  const language = el(
    'select',
    { onchange: (e) => api.setSetting('language', e.target.value) },
    [
      ['app', 'Как интерфейс'],
      ['auto', 'Как на телефоне']
    ].map(([v, label]) => el('option', { value: v, text: label, selected: (state.language === 'auto' ? 'auto' : 'app') === v }))
  );

  const badgeStyle = el(
    'select',
    { onchange: (e) => api.setSetting('badgeStyle', e.target.value) },
    [
      ['count', 'Цифра'],
      ['dot', 'Точка'],
      ['none', 'Не показывать']
    ].map(([v, label]) => el('option', { value: v, text: label, selected: (state.badgeStyle || 'count') === v }))
  );

  const downloads = state.downloads || { mode: 'folder', folder: '', notify: true };
  const saveDownloads = (patch) => api.setSetting('downloads', { ...downloads, ...patch });
  const downloadMode = el(
    'select',
    { onchange: (e) => saveDownloads({ mode: e.target.value }) },
    [
      ['folder', 'Сохранять в папку'],
      ['ask', 'Спрашивать, куда сохранить']
    ].map(([v, label]) => el('option', { value: v, text: label, selected: downloads.mode === v }))
  );
  const downloadNotify = el('input', { type: 'checkbox', checked: !!downloads.notify, onchange: (e) => saveDownloads({ notify: e.target.checked }) });
  const startHidden = el('input', { type: 'checkbox', checked: !!state.startHidden, onchange: (e) => api.setSetting('startHidden', e.target.checked) });
  const handleLinks = el('input', { type: 'checkbox', checked: !!state.handleLinks, onchange: (e) => api.setSetting('handleLinks', e.target.checked) });
  const spellcheck = el('input', { type: 'checkbox', checked: !!state.spellcheck, onchange: (e) => api.setSetting('spellcheck', e.target.checked) });

  const dnd = state.dnd || { enabled: false, from: '23:00', to: '08:00' };
  const dndFrom = el('input', { type: 'time', value: dnd.from, class: 'time' });
  const dndTo = el('input', { type: 'time', value: dnd.to, class: 'time' });
  const dndOn = el('input', { type: 'checkbox', checked: dnd.enabled });
  const saveDnd = () => api.setSetting('dnd', { enabled: dndOn.checked, from: dndFrom.value || '23:00', to: dndTo.value || '08:00' });
  for (const input of [dndFrom, dndTo, dndOn]) input.addEventListener('change', saveDnd);

  const scheduledList = state.scheduled.length
    ? el(
        'div',
        { class: 'scheduled' },
        state.scheduled.map((m) =>
          el('div', { class: 'scheduled-row' }, [
            el('div', { class: 'scheduled-main' }, [
              el('div', { class: 'scheduled-head no-tr', text: `${m.chatName || t('Чат')} · ${formatWhen(m.at)}${state.accounts.length > 1 ? ' · ' + m.account : ''}` }),
              el('div', { class: 'muted small ellipsis no-tr', text: m.text }),
              m.error ? el('div', { class: 'error', text: 'Повтор: ' + m.error }) : null
            ]),
            el('button', { class: 'icon-btn', title: 'Отменить', text: '✕', onclick: () => api.scheduleCancel(m.id) })
          ])
        )
      )
    : el('p', { class: 'muted small', text: 'Нет. Наберите текст в чате и нажмите ⏱ рядом с микрофоном.' });

  modalShell('Настройки Tandem Chat', [
    el('h3', { text: 'Оформление' }),
    themeRow,
    el('div', { class: 'row' }, [el('span', { text: 'Ночная тема' }), themeMode]),
    state.themeMode === 'schedule' ? el('div', { class: 'row' }, [el('span', { class: 'muted', text: 'Ночь с … до' }), el('span', { class: 'times' }, [nightFrom, nightTo])]) : null,
    el('div', { class: 'row' }, [el('span', { text: 'Список чатов' }), density]),
    el('div', { class: 'row' }, [el('span', { text: 'Масштаб' }), el('span', { class: 'times' }, [zoom, zoomValue])]),
    el('label', { class: 'row check' }, [el('span', { text: '«Сообщения себе» как «Избранное»' }), favorite]),
    el('div', { class: 'row' }, [el('span', { text: 'Язык интерфейса' }), uiLanguage]),
    el('div', { class: 'row' }, [el('span', { text: 'Язык WhatsApp' }), language]),
    el('label', { class: 'row check' }, [el('span', { text: 'Показывать вкладки-группировки (Все, Непрочитанное, Группы…)' }), showFilters]),
    el('h3', { text: 'Аккаунты' }),
    accountsList,
    el('button', { class: 'link', text: '+ Добавить аккаунт', onclick: addAccountModal }),
    el('h3', { text: 'Приватность' }),
    el('label', { class: 'row check' }, [el('span', { text: 'Размывать переписку, пока не наведёшь мышь (Ctrl+Shift+B)' }), blur]),
    el('label', { class: 'row check' }, [el('span', { text: 'Не показывать собеседникам «печатает…»' }), hideTyping]),
    el('p', { class: 'muted small', text: 'Статус «в сети» скрывается в самом WhatsApp: Настройки → Конфиденциальность → Время посещения и «в сети».' }),
    el('div', { class: 'row' }, [
      el('span', { text: `Защищённые чаты: ${state.lockedChats.length}` }),
      el('button', { class: 'link', text: 'Выбрать', onclick: () => lockChatsModal() })
    ]),
    !state.hasPasscode && state.lockedChats.length ? el('p', { class: 'error', text: 'Чтобы чаты были защищены, установите код-пароль ниже.' }) : null,
    el('h3', { text: 'Папки Tandem Chat' }),
    foldersList,
    el('button', { class: 'link', text: '+ Новая папка', onclick: () => folderModal({ accountId: state.activeId }) }),
    el('h3', { text: 'Шаблоны ответов' }),
    templatesBox,
    el('h3', { text: 'Безопасность' }),
    el('div', { class: 'row' }, [
      el('span', { text: state.hasPasscode ? 'Код-пароль включён' : 'Код-пароль выключен' }),
      el('button', { class: 'link', text: state.hasPasscode ? 'Изменить' : 'Установить', onclick: passcodeModal })
    ]),
    el('div', { class: 'row' }, [el('span', { text: 'Автоблокировка' }), autolock]),
    el('h3', { text: 'Уведомления' }),
    el('div', { class: 'row' }, [el('span', { text: 'Вид уведомлений' }), noteStyle]),
    el('button', { class: 'link', text: 'Показать пример уведомления', onclick: () => api.testNote() }),
    el('label', { class: 'row check' }, [el('span', { text: 'Не беспокоить по расписанию' }), dndOn]),
    el('div', { class: 'row' }, [el('span', { class: 'muted', text: 'С … до' }), el('span', { class: 'times' }, [dndFrom, dndTo])]),
    state.dndActive ? el('p', { class: 'muted small', text: 'Сейчас действует «не беспокоить».' }) : null,
    el('p', { class: 'muted small', text: 'Колокольчик у аккаунта выше выключает уведомления только для него.' }),
    el('div', { class: 'row' }, [el('span', { text: 'Значок непрочитанных' }), badgeStyle]),
    el('p', { class: 'muted small', text: 'На панели задач и в трее.' }),
    el('h3', { text: 'Отложенные сообщения' }),
    scheduledList,
    el('h3', { text: 'Напоминания' }),
    remindersList,
    el('h3', { text: 'Загрузки' }),
    el('div', { class: 'row' }, [el('span', { text: 'Куда сохранять' }), downloadMode]),
    downloads.mode === 'folder'
      ? el('div', { class: 'row' }, [
          el('span', { class: 'muted small ellipsis no-tr path', title: downloads.folder, text: downloads.folder }),
          el('span', { class: 'times' }, [
            el('button', { class: 'link', text: 'Изменить', onclick: () => api.downloadsPick() }),
            el('button', { class: 'link', text: 'Открыть', onclick: () => api.downloadsOpen() })
          ])
        ])
      : el('p', { class: 'muted small', text: 'Если скачать сразу несколько файлов, Tandem Chat спросит папку один раз — для всех.' }),
    el('label', { class: 'row check' }, [el('span', { text: 'Уведомлять о завершённых загрузках' }), downloadNotify]),
    el('h3', { text: 'Система' }),
    el('label', { class: 'row check' }, [el('span', { text: 'Запускать вместе с Windows' }), autostart]),
    el('label', { class: 'row check' + (state.autostart ? '' : ' dim') }, [el('span', { text: 'При автозапуске сворачивать в трей' }), startHidden]),
    el('label', { class: 'row check' }, [el('span', { text: 'Открывать ссылки WhatsApp (wa.me, whatsapp://) в Tandem Chat' }), handleLinks]),
    el('label', { class: 'row check' }, [el('span', { text: 'Проверка орфографии (русский и английский)' }), spellcheck]),
    el('label', { class: 'row check' }, [el('span', { text: 'Показать/спрятать из любой программы: Ctrl+Shift+W' }), globalHotkey]),
    state.globalHotkey && state.hotkeyOk === false ? el('p', { class: 'error', text: 'Ctrl+Shift+W занята другой программой — сочетание не работает.' }) : null,
    el('button', { class: 'link', text: 'Мини-режим: маленькое окно 380×640', onclick: () => api.miniMode() }),
    el('h3', { text: 'Резервная копия' }),
    el('p', { class: 'muted small', text: 'Папки, шаблоны, темы, защищённые чаты, уведомления и другие настройки. Код-пароль в файл не попадает.' }),
    el('div', { class: 'row' }, [
      el('button', { class: 'link', text: 'Сохранить в файл', onclick: async () => { const r = await api.backupExport(); backupStatus.textContent = lastBackupStatus = r.ok ? 'Сохранено: ' + r.file : r.canceled ? '' : r.error || 'Ошибка'; } }),
      el('button', { class: 'link', text: 'Восстановить из файла', onclick: async () => { const r = await api.backupImport(); backupStatus.textContent = lastBackupStatus = r.ok ? 'Настройки восстановлены' : r.canceled ? '' : r.error || 'Ошибка'; } })
    ]),
    backupStatus,
    el('h3', { text: 'Совместимость с WhatsApp' }),
    ...(diagRows.length ? diagRows : [el('p', { class: 'muted small', text: 'Проверка выполняется после входа в WhatsApp.' })]),
    el('h3', { text: 'Горячие клавиши' }),
    el('div', { class: 'keys' }, [
      ['Ctrl+Tab / Alt+↓', 'Следующий чат'],
      ['Ctrl+Shift+Tab / Alt+↑', 'Предыдущий чат'],
      ['Ctrl+F / Ctrl+K', 'Поиск'],
      ['Ctrl+1…5', 'Разделы'],
      ['Ctrl+Shift+1…9', 'Аккаунты'],
      ['Ctrl+N', 'Новый чат'],
      ['Ctrl+L', 'Заблокировать'],
      ['Ctrl+W', 'Свернуть в трей'],
      ['Ctrl+Q', 'Выход'],
      ['Двойной клик', 'Ответить на сообщение'],
      ['Alt + клик по чату', 'Предпросмотр'],
      ['/шаблон + Tab', 'Вставить шаблон'],
      ['Ctrl+Shift+B', 'Размытие'],
      ['↑ в пустом поле', 'Изменить последнее']
    ].map(([k, t]) => el('div', {}, [el('kbd', { text: k }), el('span', { text: t })])))
  ], null, false);
}

const DRAWER_ICONS = {
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
  newChat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M12 9v6M9 12h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bookmark: '<path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z"/>',
  group: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M18 8v6M15 11h6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  select: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  read: '<path d="M3 12l4 4L17 6M11 15l1 1 9-10"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  mini: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="11" width="7" height="7" rx="1"/>'
};

function drawerIcon(markup) {
  const wrap = document.createElement('span');
  wrap.className = 'icon';
  wrap.innerHTML = `<svg viewBox="0 0 24 24">${markup}</svg>`;
  return wrap;
}

function drawerItem(iconMarkup, label, onclick, extra) {
  return el('button', { class: 'drawer-item', onclick }, [drawerIcon(iconMarkup), el('span', { class: 'drawer-label', text: label }), extra || null]);
}

function drawerModal() {
  currentModal = 'drawer';
  const active = state.accounts.find((a) => a.id === state.activeId) || state.accounts[0];
  const dark = !/light$/.test(state.theme);
  const family = state.theme.startsWith('green') ? 'green' : 'blue';

  const head = el('div', { class: 'drawer-head' }, [
    avatar(active, 56),
    el('div', { class: 'drawer-name no-tr', text: active.name }),
    el('div', { class: 'drawer-sub', text: active.loggedIn ? 'WhatsApp подключён' : 'Нужно войти по QR-коду' })
  ]);

  const accounts = el('div', { class: 'drawer-group' }, [
    ...state.accounts.map((a) =>
      el(
        'button',
        {
          class: 'drawer-item account-item' + (a.id === state.activeId ? ' current' : ''),
          onclick: () => {
            api.activate(a.id);
            closeModal();
          }
        },
        [avatar(a, 30), el('span', { class: 'drawer-label no-tr', text: a.name }), a.id !== state.activeId && a.unread ? el('span', { class: 'pill', text: String(a.unread) }) : null]
      )
    ),
    drawerItem(DRAWER_ICONS.plus, 'Добавить аккаунт', addAccountModal)
  ]);

  const toggle = el('span', { class: 'switch' + (dark ? ' on' : '') });

  const items = el('div', { class: 'drawer-scroll' }, [
    accounts,
    el('div', { class: 'drawer-sep' }),
    drawerItem(DRAWER_ICONS.bookmark, 'Избранное', () => api.favorite('open')),
    drawerItem(DRAWER_ICONS.archive, 'Архив', () => api.waAction('archive')),
    drawerItem(ICONS.profile, 'Мой профиль', () => api.openSection(9)),
    el('div', { class: 'drawer-sep' }),
    drawerItem(DRAWER_ICONS.newChat, 'Новый чат', () => api.waAction('new-chat')),
    drawerItem(DRAWER_ICONS.group, 'Новая группа', () => api.waAction('menu:ic-group-add')),
    drawerItem(DRAWER_ICONS.star, 'Избранные сообщения', () => api.waAction('menu:ic-grade')),
    drawerItem(DRAWER_ICONS.select, 'Выбрать чаты', () => api.waAction('menu:ic-check-box')),
    drawerItem(DRAWER_ICONS.read, 'Прочитать всё', () => api.waAction('menu:wds-ic-chat')),
    drawerItem(ICONS.calls, 'Звонки', () => api.openSection(1)),
    drawerItem(ICONS.status, 'Статус', () => api.openSection(2)),
    drawerItem(ICONS.channels, 'Каналы', () => api.openSection(3)),
    drawerItem(ICONS.communities, 'Сообщества', () => api.openSection(4)),
    el('div', { class: 'drawer-sep' }),
    drawerItem(DRAWER_ICONS.settings, 'Настройки Tandem Chat', settingsModal),
    drawerItem(DRAWER_ICONS.mini, 'Мини-режим', () => api.miniMode()),
    drawerItem(DRAWER_ICONS.lock, state.hasPasscode ? 'Заблокировать' : 'Код-пароль', () => (state.hasPasscode ? api.lock() : passcodeModal())),
    drawerItem(DRAWER_ICONS.logout, 'Выйти из WhatsApp', () => api.waAction('menu:ic-logout')),
    drawerItem(DRAWER_ICONS.moon, 'Ночной режим', () => api.setTheme(`${family}-${dark ? 'light' : 'dark'}`), toggle)
  ]);

  $('modal').classList.add('drawer-mode');
  $('modal-body').className = 'drawer';
  $('modal-body').replaceChildren(head, items, el('div', { class: 'drawer-foot', text: 'Tandem Chat' }));
  $('modal').hidden = false;
}

const MODALS = { settings: settingsModal, passcode: passcodeModal, 'add-account': addAccountModal, drawer: drawerModal };

function formatWhen(at) {
  const d = new Date(at);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const sep = EN_UI ? ' at ' : ' в ';
  if (d.toDateString() === now.toDateString()) return (EN_UI ? 'today' : 'сегодня') + sep + time;
  if (d.toDateString() === tomorrow.toDateString()) return (EN_UI ? 'tomorrow' : 'завтра') + sep + time;
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' }) + sep + time;
}

const SOUNDS = {
  note: [[880, 1320, 0.25]],
  bell: [[1046, 1046, 0.5], [1568, 1568, 0.6]],
  drop: [[1400, 500, 0.18]]
};

function playSound(kind) {
  const tones = SOUNDS[kind];
  if (!tones) return;
  try {
    const ctx = new AudioContext();
    tones.forEach(([from, to, length], i) => {
      const start = ctx.currentTime + i * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(from, start);
      osc.frequency.exponentialRampToValueAtTime(to, start + length * 0.4);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + length + 0.05);
    });
  } catch {}
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return n + ' ' + word;
}

function templatesEditor() {
  const box = el('div', { class: 'templates-edit' });
  const rows = state.templates.map((t) => ({ ...t }));
  const save = () => api.setTemplates(rows.filter((r) => r.key.trim() && r.text.trim()));
  const render = () => {
    box.replaceChildren(
      ...rows.map((r, i) => {
        const key = el('input', { type: 'text', value: r.key, placeholder: 'ключ', maxlength: 20, class: 'tkey' });
        const text = el('input', { type: 'text', value: r.text, placeholder: 'Текст ответа', maxlength: 2000 });
        key.addEventListener('change', () => {
          r.key = key.value.replace(/^\//, '').replace(/\s+/g, '');
          save();
        });
        text.addEventListener('change', () => {
          r.text = text.value;
          save();
        });
        return el('div', { class: 'template-row' }, [
          el('span', { class: 'muted', text: '/' }),
          key,
          text,
          el('button', {
            class: 'icon-btn',
            title: 'Удалить',
            text: '✕',
            onclick: () => {
              rows.splice(i, 1);
              save();
              render();
            }
          })
        ]);
      }),
      el('button', {
        class: 'link',
        text: '+ Шаблон',
        onclick: () => {
          rows.push({ key: '', text: '' });
          render();
          const inputs = box.querySelectorAll('.tkey');
          if (inputs.length) inputs[inputs.length - 1].focus();
        }
      }),
      el('p', { class: 'muted small', text: 'В чате наберите /ключ и нажмите Tab или выберите из подсказки.' })
    );
  };
  render();
  return box;
}

function chatPicker({ multi, selected, onChange, onPick, exclude }) {
  const wrap = el('div', { class: 'picker' });
  const search = el('input', { type: 'text', placeholder: 'Поиск чата', autocomplete: 'off' });
  const list = el('div', { class: 'picker-list' }, [el('p', { class: 'muted small', text: 'Загрузка…' })]);
  wrap.append(search, list);
  let chats = [];
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const items = chats.filter((c) => (!exclude || !exclude.includes(c.id)) && (!q || c.title.toLowerCase().includes(q))).slice(0, 150);
    list.replaceChildren(
      ...items.map((c) => {
        const pic = el('span', { class: 'picker-avatar', text: c.pic ? '' : (c.title[0] || '?').toUpperCase() });
        if (c.pic) pic.style.backgroundImage = `url("${c.pic}")`;
        const checked = selected && selected.has(c.id);
        return el(
          'button',
          {
            class: 'picker-item' + (checked ? ' checked' : ''),
            onclick: () => {
              if (multi) {
                if (selected.has(c.id)) selected.delete(c.id);
                else selected.add(c.id);
                onChange && onChange();
                render();
              } else onPick(c);
            }
          },
          [pic, el('span', { class: 'picker-title no-tr', text: (c.kind === 'group' ? '👥 ' : c.kind === 'channel' ? '📢 ' : '') + c.title }), multi ? el('span', { class: 'picker-check', text: checked ? '✓' : '' }) : null]
        );
      })
    );
    if (!items.length) list.append(el('p', { class: 'muted small', text: 'Ничего не найдено' }));
  };
  search.addEventListener('input', render);
  api.chatList().then((res) => {
    chats = res || [];
    render();
  });
  setTimeout(() => search.focus(), 60);
  return wrap;
}

function forwardModal(data) {
  const error = el('p', { class: 'error' });
  modalShell(
    'Переслать без подписи',
    [
      el('div', { class: 'quote no-tr', text: data.text || '' }),
      chatPicker({
        multi: false,
        onPick: async (chat) => {
          const res = await api.forward({ accountId: data.accountId, msgId: data.msgId, targetId: chat.id });
          if (!res.ok) error.textContent = res.error || 'Не удалось переслать';
        }
      }),
      error
    ],
    null,
    false
  );
}

function remindModal(data) {
  const now = new Date();
  const { morning } = presetTimes();
  const in20 = new Date(now.getTime() + 20 * 60000);
  const inHour = new Date(now.getTime() + 3600000);
  const in3 = new Date(now.getTime() + 3 * 3600000);
  for (const d of [in20, inHour, in3]) d.setSeconds(0, 0);
  const picker = whenPicker(inHour, [['Через 20 минут', in20], ['Через час', inHour], ['Через 3 часа', in3], ['Завтра в 9:00', morning]], 'Напомню');
  const error = el('p', { class: 'error' });
  const submit = async () => {
    const res = await api.reminderAdd({ ...data, at: picker.get().getTime() });
    if (!res.ok) error.textContent = res.error || 'Не удалось';
  };
  modalShell(
    'Напомнить о сообщении',
    [messageBubble(data.chatName, data.text), picker.node, error],
    [el('button', { class: 'ghost', text: 'Отмена', onclick: closeModal }), el('button', { class: 'ghost strong', text: 'Напомнить', onclick: submit })],
    false
  );
}

function folderModal(data) {
  const existing = state.folders.find((f) => f.id === data.folderId);
  const selected = new Set(existing ? existing.chatIds : []);
  const name = el('input', { type: 'text', value: existing ? existing.name : '', placeholder: 'Например, Работа', maxlength: 30 });
  const counter = el('span', { class: 'muted small', text: count(selected.size, ['чат выбран', 'чата выбрано', 'чатов выбрано'], ['chat selected', 'chats selected']) });
  const error = el('p', { class: 'error' });
  const save = async () => {
    const res = await api.folderSave({ id: existing && existing.id, name: name.value, chatIds: [...selected] });
    if (!res.ok) error.textContent = res.error || 'Не удалось сохранить';
  };
  modalShell(
    existing ? 'Папка «' + existing.name + '»' : 'Новая папка',
    [
      field('Название', name),
      counter,
      chatPicker({ multi: true, selected, onChange: () => (counter.textContent = count(selected.size, ['чат выбран', 'чата выбрано', 'чатов выбрано'], ['chat selected', 'chats selected'])) }),
      error
    ],
    [
      existing ? el('button', { class: 'danger', text: 'Удалить', onclick: () => api.folderDelete(existing.id) }) : null,
      el('span', { class: 'grow' }),
      el('button', { class: 'ghost', text: 'Отмена', onclick: closeModal }),
      el('button', { class: 'primary', text: 'Сохранить', onclick: save })
    ],
    false
  );
}

function lockChatsModal() {
  const selected = new Set(state.lockedChats);
  const counter = el('span', { class: 'muted small', text: count(selected.size, ['чат', 'чата', 'чатов'], ['chat', 'chats']) });
  modalShell(
    'Защищённые чаты',
    [
      el('p', { class: 'muted small', text: 'Эти чаты открываются только после ввода код-пароля Tandem Chat, их превью размыто, а уведомления приходят без текста.' }),
      counter,
      chatPicker({ multi: true, selected, onChange: () => (counter.textContent = count(selected.size, ['чат', 'чата', 'чатов'], ['chat', 'chats'])) })
    ],
    [el('button', { class: 'ghost', text: 'Отмена', onclick: settingsModal }), el('button', { class: 'primary', text: 'Сохранить', onclick: () => api.setLockedChats([...selected]) })],
    false
  );
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const pad2 = (n) => String(n).padStart(2, '0');
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function dayLabel(offset, today) {
  const d = new Date(today);
  d.setDate(today.getDate() + offset);
  if (EN_UI) {
    const base = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (offset === 0) return 'Today, ' + base;
    if (offset === 1) return 'Tomorrow, ' + base;
    return d.toLocaleDateString('en-US', { weekday: 'short' }) + ', ' + base;
  }
  const base = d.getDate() + ' ' + MONTHS[d.getMonth()];
  if (offset === 0) return 'Сегодня, ' + base;
  if (offset === 1) return 'Завтра, ' + base;
  return WEEKDAYS[d.getDay()] + ', ' + base;
}

function whenPicker(initial, presets, verb) {
  const today = startOfDay(new Date());
  const day = el(
    'select',
    { class: 'when-day' },
    Array.from({ length: 60 }, (_, i) => el('option', { value: i, text: dayLabel(i, today) }))
  );
  const time = el('input', { type: 'time', class: 'when-time' });
  const summary = el('p', { class: 'when-summary' });
  const get = () => {
    const d = new Date(today);
    d.setDate(today.getDate() + Number(day.value));
    const [h, m] = (time.value || '00:00').split(':').map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
  };
  const update = () => {
    const d = get();
    const past = d.getTime() <= Date.now();
    summary.textContent = past ? t('Это время уже прошло') : t(verb) + ' ' + formatWhen(d.getTime());
    summary.classList.toggle('error', past);
    for (const chip of chips.querySelectorAll('.choice')) chip.classList.toggle('active', Number(chip.dataset.at) === d.getTime());
  };
  const set = (date) => {
    const offset = Math.round((startOfDay(date) - today) / 86400000);
    day.value = String(Math.max(0, Math.min(59, offset)));
    time.value = pad2(date.getHours()) + ':' + pad2(date.getMinutes());
    update();
  };
  const chips = el(
    'div',
    { class: 'choices when-presets' },
    presets
      .filter(([, d]) => d > new Date())
      .map(([label, d]) => {
        const chip = el('button', { class: 'choice', text: label, onclick: () => set(d) });
        chip.dataset.at = String(d.getTime());
        return chip;
      })
  );
  day.addEventListener('change', update);
  time.addEventListener('input', update);
  set(initial);
  const node = el('div', { class: 'when' }, [el('div', { class: 'when-row' }, [day, el('span', { class: 'when-at', text: 'в' }), time]), chips, summary]);
  return { node, get };
}

function presetTimes() {
  const now = new Date();
  const inHour = new Date(now.getTime() + 3600000);
  inHour.setSeconds(0, 0);
  const evening = new Date(now);
  evening.setHours(20, 0, 0, 0);
  const morning = new Date(now);
  morning.setDate(now.getDate() + 1);
  morning.setHours(9, 0, 0, 0);
  return { inHour, evening, morning };
}

function messageBubble(chatName, text) {
  return el('div', { class: 'msg-preview no-tr' }, [el('div', { class: 'msg-preview-chat', text: chatName || t('Чат') }), el('div', { class: 'msg-preview-bubble', text })]);
}

function scheduleModal(data) {
  const { inHour, evening, morning } = presetTimes();
  const picker = whenPicker(inHour, [['Через час', inHour], ['Сегодня в 20:00', evening], ['Завтра в 9:00', morning]], 'Будет отправлено');
  const error = el('p', { class: 'error' });
  const submit = async () => {
    const at = picker.get().getTime();
    if (at <= Date.now()) return (error.textContent = 'Выберите время в будущем');
    const res = await api.scheduleAdd({ ...data, at });
    if (!res.ok) error.textContent = res.error || 'Не удалось запланировать';
  };
  modalShell(
    'Отправить позже',
    [messageBubble(data.chatName, data.text), picker.node, el('p', { class: 'muted small', text: 'Отправит Tandem Chat — он должен быть запущен, можно свёрнутым в трей.' }), error],
    [el('button', { class: 'ghost', text: 'Отмена', onclick: closeModal }), el('button', { class: 'ghost strong', text: 'Запланировать', onclick: submit })],
    false
  );
}

function editMessageModal(data) {
  const text = el('textarea', { rows: 4, maxlength: 4000 });
  text.value = data.text;
  const error = el('p', { class: 'error' });
  const save = async () => {
    if (!text.value.trim()) return (error.textContent = 'Сообщение не может быть пустым');
    if (text.value.trim() === data.text.trim()) return closeModal();
    const res = await api.editSave({ accountId: data.accountId, id: data.id, text: text.value });
    if (!res.ok) error.textContent = res.error || 'Не удалось изменить';
  };
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  });
  modalShell('Изменить сообщение', [text, el('p', { class: 'muted small', text: 'Enter — сохранить, Shift+Enter — новая строка.' }), error], [
    el('button', { class: 'ghost', text: 'Отмена', onclick: closeModal }),
    el('button', { class: 'primary', text: 'Сохранить', onclick: save })
  ]);
  setTimeout(() => {
    text.focus();
    text.setSelectionRange(text.value.length, text.value.length);
  }, 60);
}

api.onModal((name, data) => {
  if (!name) {
    $('modal').hidden = true;
    currentModal = null;
    return;
  }
  if (name === 'schedule' && data) return scheduleModal(data);
  if (name === 'edit-message' && data) return editMessageModal(data);
  if (name === 'forward' && data) return forwardModal(data);
  if (name === 'remind' && data) return remindModal(data);
  if (name === 'folder') return folderModal(data || {});
  if (name === 'lock-chats') return lockChatsModal();
  (MODALS[name] || settingsModal)();
});

api.onState((next) => {
  const typing = document.activeElement && document.activeElement.matches('#modal input[type="text"], #modal input[type="password"]');
  const reopen = state && !typing && !$('modal').hidden ? currentModal : null;
  state = next;
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.classList.toggle('compact', !!state.compact);
  renderRail();
  renderLock();
  drawTaskbarBadge(state.accounts.reduce((s, a) => s + a.unread, 0), state.badgeStyle || 'count');
  if (state.locked) return;
  if (reopen === 'settings') settingsModal();
  if (reopen === 'drawer') drawerModal();
});

$('add-account').addEventListener('click', () => api.openModal('add-account'));
$('settings-btn').addEventListener('click', () => api.openModal('settings'));
$('lock-btn').addEventListener('click', () => (state && state.hasPasscode ? api.lock() : api.openModal('passcode')));
$('modal').addEventListener('mousedown', (e) => e.target === $('modal') && closeModal());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('modal').hidden) closeModal();
});

$('lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('lock-input');
  const res = await api.unlock(input.value);
  input.value = '';
  if (!res.ok) {
    $('lock-error').textContent = res.error || 'Неверный код-пароль';
    $('lock-form').classList.remove('shake');
    void $('lock-form').offsetWidth;
    $('lock-form').classList.add('shake');
  }
});
