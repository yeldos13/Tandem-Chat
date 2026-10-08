<p align="center">
  <img src="assets/icon.png" width="96" alt="Tandem Chat">
</p>

<h1 align="center">Tandem Chat</h1>

<p align="center">An unofficial WhatsApp Web desktop client for Windows with a compact, keyboard-friendly interface.</p>

<p align="center"><a href="#english">English</a> · <a href="#русский">Русский</a></p>

---

## English

Tandem Chat is an Electron desktop app that opens the official WhatsApp Web in its own window and adds a cleaner interface and extra features on top of it: a compact chat list, a side rail, chat folders, scheduled messages, a passcode lock, multiple accounts and much more. The interface is inspired by Telegram Desktop.

> **Unofficial client.** Tandem Chat is not made, endorsed or supported by WhatsApp or Meta. It runs WhatsApp Web unchanged and adds its own interface around it, but WhatsApp's terms do not allow unofficial clients, and WhatsApp may limit or ban accounts that use them. Use it at your own risk.

### Download

Get the latest version from [Releases](../../releases/latest):

- **Tandem Chat Setup X.Y.Z.exe** — installer. You can choose English or Russian during setup, and the app starts in that language.
- **Tandem Chat Portable X.Y.Z.exe** — portable build, runs without installation.

Requirements: Windows 10 or 11, 64-bit.

### Features

**Appearance**
- Blue and green themes, each in night and day variants, plus the original WhatsApp look.
- Night mode set manually, following Windows, or on a schedule.
- Compact mode for narrow windows, a 380×640 mini mode, zoom and list density.
- "Message yourself" shown as "Saved Messages".
- English and Russian interface.

**Chats and messages**
- Chat folders on top of the WhatsApp filter tabs.
- Alt+click a chat to preview it without opening it.
- Double-click a message to reply, press ↑ in an empty field to edit your last message.
- Scheduled sending (the ⏱ button or right-click on Send) and message reminders.
- Reply templates: `/key` + Tab.
- Save to Saved Messages and forward without the "Forwarded" label.
- Drag files into an open chat or onto a chat in the list.
- Right-click menu with spell check (English and Russian).
- `wa.me`, `chat.whatsapp.com` and `whatsapp://` links open in the app.

**Notifications**
- Custom pop-up notifications with quick reply, or native Windows notifications.
- Scheduled Do Not Disturb, mute per account.
- Unread badge in the tray and on the taskbar: number, dot or hidden.

**Accounts and privacy**
- Multiple WhatsApp accounts, each with its own session and notification sound.
- App passcode and auto-lock. While the app is locked, notifications arrive without text.
- Locked chats that open only after entering the passcode.
- Blur chats until you hover over them, hide your "typing…" status.

**System**
- Minimize to the tray, start with Windows (optionally minimized).
- Show or hide the window from any app with Ctrl+Shift+W.
- Downloads go to a chosen folder without overwriting files, or ask where to save — once per batch of files.
- Back up settings (folders, templates, themes and more) to a file and restore them.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+Tab / Alt+↓ | Next chat |
| Ctrl+Shift+Tab / Alt+↑ | Previous chat |
| Ctrl+F / Ctrl+K | Search |
| Ctrl+N | New chat |
| Ctrl+1…5 | Chats, calls, status, channels, communities |
| Ctrl+Shift+1…9 | Switch accounts |
| Ctrl+L | Lock |
| Ctrl+Shift+B | Blur chats |
| Ctrl+= / Ctrl+− / Ctrl+0 | Zoom |
| Ctrl+W | Hide to the tray |
| Ctrl+Q | Quit |
| Ctrl+Shift+W | Show or hide the window from any app |

### Privacy

Tandem Chat loads the official WhatsApp Web: messages travel directly between the app and WhatsApp's servers, end-to-end encrypted as usual. Sessions, settings and the passcode are stored only on your computer (the passcode as a salted hash). The app has no servers of its own, collects no analytics, sends nothing to third parties and does not update itself.

### Building from source

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm start
```

Build the installer and the portable version into `dist`:

```bash
npm run dist
```

For debugging you can run a separate copy with its own profile:

```bash
npx electron . --user-data-dir=%TEMP%\tandem-test
```

### Project structure

| Path | Contents |
|---|---|
| `src/main.js` | Main process: windows, accounts, tray, themes, notifications, downloads, links |
| `src/preload.js` | WhatsApp page script: Tandem Chat buttons and features inside WhatsApp Web |
| `src/shell/` | Side rail, drawer, settings, lock screen |
| `src/notify/`, `src/notifier.js` | Pop-up notifications with quick reply |
| `src/themes/` | Layout and color themes |
| `src/i18n.js` | English UI translations |
| `src/store.js` | Settings storage |
| `build/installer.nsh` | Language selection in the installer |

### License

[MIT](LICENSE)

---

## Русский

Tandem Chat — неофициальный настольный клиент WhatsApp Web для Windows. Приложение на Electron открывает официальный WhatsApp Web в отдельном окне и добавляет к нему более удобный интерфейс и функции: компактный список чатов, боковую панель, папки, отложенную отправку, код-пароль, несколько аккаунтов и многое другое. Интерфейс вдохновлён Telegram Desktop.

> **Неофициальный клиент.** Tandem Chat не создан, не одобрен и не поддерживается WhatsApp или Meta. Он запускает WhatsApp Web без изменений и добавляет вокруг свой интерфейс, но условия WhatsApp не разрешают неофициальные клиенты, и WhatsApp может ограничить или заблокировать аккаунт, который ими пользуется. Используйте на свой риск.

### Скачать

Последняя версия — на странице [Releases](../../releases/latest):

- **Tandem Chat Setup X.Y.Z.exe** — установщик. При установке можно выбрать русский или английский язык, приложение запустится на нём же.
- **Tandem Chat Portable X.Y.Z.exe** — портативная версия, работает без установки.

Требования: Windows 10 или 11, 64-бит.

### Возможности

**Оформление**
- Синие и зелёные темы, ночные и светлые, плюс оригинальный вид WhatsApp.
- Ночной режим вручную, как в Windows или по расписанию.
- Компактный режим для узкого окна, мини-режим 380×640, масштаб и плотность списка.
- «Сообщения себе» в виде «Избранного».
- Интерфейс на русском и английском.

**Чаты и сообщения**
- Папки чатов поверх вкладок WhatsApp.
- Предпросмотр чата по Alt+клик, не открывая его.
- Ответ двойным кликом, правка последнего сообщения стрелкой ↑.
- Отложенная отправка (кнопка ⏱ или правый клик по «Отправить») и напоминания о сообщениях.
- Шаблоны ответов: `/ключ` + Tab.
- Сохранение в «Избранное» и пересылка без пометки «Переслано».
- Перетаскивание файлов в открытый чат или на чат в списке.
- Меню правой кнопки с проверкой орфографии (русский и английский).
- Ссылки `wa.me`, `chat.whatsapp.com` и `whatsapp://` открываются в приложении.

**Уведомления**
- Свои всплывающие уведомления с быстрым ответом или системные уведомления Windows.
- «Не беспокоить» по расписанию, отключение уведомлений для отдельного аккаунта.
- Счётчик непрочитанных в трее и на панели задач: цифра, точка или скрыт.

**Аккаунты и приватность**
- Несколько аккаунтов WhatsApp, у каждого своя сессия и свой звук уведомлений.
- Код-пароль на приложение и автоблокировка. Пока приложение заблокировано, уведомления приходят без текста.
- Защищённые чаты, которые открываются только после ввода код-пароля.
- Размытие переписки до наведения мыши, скрытие статуса «печатает…».

**Система**
- Сворачивание в трей, запуск вместе с Windows (можно сразу свёрнутым).
- Показать и спрятать окно из любой программы сочетанием Ctrl+Shift+W.
- Загрузки в выбранную папку без перезаписи файлов или с вопросом «куда сохранить» — один раз на пачку файлов.
- Резервная копия настроек (папки, шаблоны, темы и другое) в файл и восстановление из него.

### Горячие клавиши

| Сочетание | Действие |
|---|---|
| Ctrl+Tab / Alt+↓ | Следующий чат |
| Ctrl+Shift+Tab / Alt+↑ | Предыдущий чат |
| Ctrl+F / Ctrl+K | Поиск |
| Ctrl+N | Новый чат |
| Ctrl+1…5 | Чаты, звонки, статус, каналы, сообщества |
| Ctrl+Shift+1…9 | Переключение аккаунтов |
| Ctrl+L | Заблокировать |
| Ctrl+Shift+B | Размытие переписки |
| Ctrl+= / Ctrl+− / Ctrl+0 | Масштаб |
| Ctrl+W | Свернуть в трей |
| Ctrl+Q | Выход |
| Ctrl+Shift+W | Показать или спрятать окно из любой программы |

### Приватность

Tandem Chat загружает официальный WhatsApp Web: переписка идёт напрямую между приложением и серверами WhatsApp со сквозным шифрованием, как обычно. Сессии, настройки и код-пароль хранятся только на вашем компьютере (код-пароль — в виде хеша с солью). У приложения нет своих серверов, оно не собирает аналитику, ничего не отправляет третьим сторонам и не обновляется само.

### Сборка из исходников

Нужен [Node.js](https://nodejs.org/) 20 или новее.

```bash
npm install
npm start
```

Собрать установщик и портативную версию в папку `dist`:

```bash
npm run dist
```

Для отладки можно запустить отдельную копию с собственным профилем:

```bash
npx electron . --user-data-dir=%TEMP%\tandem-test
```

### Лицензия

[MIT](LICENSE)

---

Tandem Chat is not affiliated with, endorsed by or sponsored by WhatsApp LLC, Meta Platforms, Inc. or Telegram FZ-LLC. WhatsApp and Telegram are trademarks of their respective owners and are mentioned only to describe compatibility and design inspiration.

Tandem Chat не связан с WhatsApp LLC, Meta Platforms, Inc. или Telegram FZ-LLC и не одобрен ими. WhatsApp и Telegram — товарные знаки их владельцев и упоминаются только для описания совместимости и источника вдохновения дизайна.
