# 68HUB Material Extension

轻量 MV3 浏览器扩展：单用户自动识别、Material 3 风格、IndexedDB 完整历史。

## 功能

- 在 `https://opencode.ai/*` 页面自动识别当前登录账户和工作区。
- 自动拉取 OpenCode Go 配额、使用记录，并用 `usg_id` 去重写入 IndexedDB。
- 记录同步断点，每次打开页面继续回填完整历史。
- popup 提供总览、模型用量、每日趋势和同步设置。

## 安装

1. 打开 Chrome/Edge 的 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目中的 `extension` 目录。
4. 登录 `https://opencode.ai` 后打开任意 workspace 页面，等待自动同步。

## 权限说明

- `storage`：保存当前账户、设置和同步快照。
- `tabs`：让 popup 识别当前是否正在 opencode.ai 页面。
- `https://opencode.ai/*`：只在 opencode.ai 页面运行内容脚本。

浏览器扩展不保存 cookie 明文，不连接本地后端。
