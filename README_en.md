# OpenCodeQME

OpenCodeQME stands for **OpenCode Quota Monitor Extension**. It monitors OpenCode workspace quota and usage.

## Features

- Compact popup: today tokens, available quota, recent records and sync status.
- Full tab view: overview, token stats, daily trends, usage records and settings.
- Floating edge button: draggable, snaps to either side, opens the selected UI mode.
- Chinese and English UI with persisted `uiMode` and language settings.
- Background sync stores full usage history in local IndexedDB.

## Install

1. Open `chrome://extensions` in Chrome or Edge.
2. Enable “Developer mode”.
3. Choose “Load unpacked” and select the `extension` directory.

You can also install `release/opencodeqme-extension.crx`.

## Build

```bash
npm run test:extension
npm run build:extension
npm run build:crx
```

Artifacts are written to `release/opencodeqme-extension.zip` and `release/opencodeqme-extension.crx`.
