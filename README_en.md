# OpenCodeQME

OpenCodeQME stands for **OpenCode Quota Monitor Extension**. It monitors OpenCode workspace quota and usage.

## Origin & Changes

- Upstream: [68HUB](https://github.com/evanfu0110/68hub), authored by `evanfu0110`.
- This project ports upstream 68HUB into a standalone MV3 browser extension; the Electron/React app, legacy assets and upstream build pipeline have been removed.
- The repository now contains only the browser extension, with new dual-mode UI, floating edge button, Chinese/English UI, full history sync and CRX packaging.

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

You can also install `release/opencodeqme-extension-0.1.0.crx`.

## Build

```bash
npm run test:extension
npm run build:extension
npm run build:crx
```

Artifacts are written to `release/opencodeqme-extension-<version>.zip` and `release/opencodeqme-extension-<version>.crx`.
