# OpenCodeQME

OpenCodeQME 全称是 **OpenCode Quota Monitor Extension**，用于监控 OpenCode 工作区配额和用量。

## 来源与改动

- 上游：[68HUB](https://github.com/evanfu0110/68hub)，作者 `evanfu0110`。
- 本项目将上游 68HUB 移植为独立 MV3 浏览器扩展，已移除 Electron/React 应用、旧素材和上游构建流程。
- 当前仓库只保留浏览器扩展，并在此基础上新增双模式 UI、边缘悬浮按钮、中英文界面、完整历史同步和 CRX 打包。

## 功能

- 小窗口预览：今日 Token、可用额度、最近记录、同步状态。
- 独立标签页：总览、Token 统计、每日趋势、使用记录、设置。
- 页面边缘悬浮按钮：可拖动、自动吸附左右边缘，点击打开对应界面。
- 中英文界面切换，并记住上次选择的 `uiMode` 和语言。
- 后台自动同步完整使用记录，数据保存在本地 IndexedDB。

## 安装

1. 打开 Chrome/Edge 的 `chrome://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，加载 `extension` 目录。

也可以使用 `release/opencodeqme-extension-0.1.0.crx` 安装。

## 构建

```bash
npm run test:extension
npm run build:extension
npm run build:crx
```

构建产物输出到 `release/opencodeqme-extension-<version>.zip` 和 `release/opencodeqme-extension-<version>.crx`。
