# OpenCodeQME

OpenCodeQME stands for **OpenCode Quota Monitor Extension**. It monitors OpenCode workspace quota and usage.

## Origin & Changes

- Upstream: [68HUB](https://github.com/evanfu0110/68hub), authored by `evanfu0110`.
- This project ports upstream 68HUB into a standalone MV3 browser extension; the Electron/React app, legacy assets and upstream build pipeline have been removed.
- The repository now contains only the browser extension, with a toolbar compact popup, full tab view, Chinese/English UI, full history sync and CRX packaging.

## Features

- Compact popup: click the toolbar extension icon to open today tokens, available quota, recent records and sync status.
- Full tab view: open from the popup, with overview, token stats, daily trends, usage records and settings.
- Chinese and English UI with persisted language settings.
- Background sync stores full usage history in local IndexedDB.

## Install

1. Open `chrome://extensions` in Chrome or Edge.
2. Enable “Developer mode”.
3. Choose “Load unpacked” and select the `extension` directory.

You can also install `release/opencodeqme-extension-0.1.0.crx`.

## Build

```bash
./build-test.sh
./build.sh
```

- `./build-test.sh` writes `release-test/opencodeqme-extension.zip` without a version suffix.
- `./build.sh` asks for a release suffix in the terminal, then writes `release/opencodeqme-extension-<suffix>.zip` and `release/opencodeqme-extension-<suffix>.crx`.
- For automation, use `OPENCODE_RELEASE_SUFFIX=0.1.0 ./build.sh` to skip the prompt.
