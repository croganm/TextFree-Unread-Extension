# TextFree Web — Local Unread & Copy Tools (Chrome extension)

Unofficial Chrome extension for [TextFree Web](https://messages.textfree.us/). It adds **local “mark unread” reminders**, **copy phone number**, and **copy conversation** (with timestamps) while you use the inbox.

**Important:** “Mark unread” does **not** change read/unread on Pinger’s servers. It only stores reminders in **`chrome.storage.local`** and adjusts inbox styling on your device.

## Features

### Local unread

- **⋯ menu → Mark unread (local)** — saves the contact’s phone digits and bolds the row (with a small dot) until you clear it.
- **Clears automatically** when:
  - You open that conversation (URL matches `/conversation/<id>` and digits match what you saved), or
  - The app’s traffic indicates the thread is read (e.g. READ status `PUT`, GET message history, or inbox JSON with `hasUnreadCommunications: false` for that recipient).
- **Popover closes** after you choose the menu item (dismiss runs in the page context via `postMessage`).

### Copy phone number

- **⎘** next to the number in the **inbox list** (beside each contact).
- **⎘** next to the number in the **conversation header** (address bar).
- Copies **digits only** to the clipboard.

### Copy conversation

- **Copy conversation** under the phone number in the **conversation header** (not a separate bar).
- Exports **visible messages** in the current thread as plain text: date separators (`communication-date`), then lines like **`[Sent] 10:31 PM`** / **`[Received] 4:54 PM`**, then message body (`innerText`, so links show as readable text).
- The extension picks the **same active thread** as the visible header and message pane (the SPA can keep multiple DOM trees; the first `querySelector` is not used for export).

## Install (developer mode)

1. Clone or download this repo.
2. Open Chrome → `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the **`extension`** folder inside this repo.

## Project layout

| Path | Purpose |
|------|---------|
| `extension/manifest.json` | Manifest V3, permissions |
| `extension/background.js` | Injects `inject-main.js` into the page (MAIN world) |
| `extension/content.js` | UI: unread menu, copy controls, storage, URL matching, conversation export |
| `extension/content.css` | Local-unread row styling, toasts, copy button layout |
| `extension/inject-main.js` | Popover dismiss bridge + `api.pinger.com` response hooks for clearing reminders |

## Permissions

| Permission | Why |
|------------|-----|
| `scripting` | Inject MAIN-world script |
| `storage` | `localUnreadDigits` in `chrome.storage.local` |
| `clipboardWrite` | Copy number / conversation text (used with user gesture) |
| `host_permissions` (messages.textfree.us) | Content script + injection on TextFree Web |

## Privacy

- Unread reminders stay in **Chrome local storage** on your machine (`localUnreadDigits`).
- Copy actions use the **clipboard locally**; nothing is sent to the extension author.
- No analytics or remote servers are used by this extension.

## Disclaimer

TextFree / Pinger are trademarks of their owners. This project is not affiliated with or endorsed by them. Use at your own risk and in line with their terms of service.

## License

[MIT](LICENSE)
