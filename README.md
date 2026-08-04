# OpenCodeQME

OpenCodeQME 全称是 **OpenCode Quota Monitor Extension**，用于监控 OpenCode 工作区配额和用量。

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

也可以使用 `release/opencodeqme-extension.crx` 安装。

## 构建

```bash
npm run test:extension
npm run build:extension
npm run build:crx
```

构建产物输出到 `release/opencodeqme-extension.zip` 和 `release/opencodeqme-extension.crx`。
