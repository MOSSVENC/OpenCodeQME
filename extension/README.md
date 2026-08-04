# 68HUB Material Extension

轻量 MV3 浏览器扩展：单用户自动识别、Material 3 风格、IndexedDB 完整历史。

## 功能

- 后台自动识别当前浏览器登录的 OpenCode Go 账户和工作区，不需要打开 opencode.ai 页面。
- 自动拉取 OpenCode Go 配额、使用记录，并用 `usg_id` 去重写入 IndexedDB。
- 使用记录按上游默认每 5 分钟同步，配额按默认 60 秒刷新。
- 记录同步断点，后台继续回填完整历史。
- popup 提供总览、模型用量、每日趋势和同步设置。

## 安装

1. 打开 Chrome/Edge 的 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目中的 `extension` 目录。
4. 在浏览器中登录一次 `https://opencode.ai`，之后不需要保持页面打开。
5. 扩展后台会自动识别账户并同步。

## 权限说明

- `storage`：保存当前账户、设置和同步快照。
- `alarms`：定时唤醒后台执行同步。
- `cookies`：检查当前 opencode.ai 登录状态。
- `https://opencode.ai/*`：允许后台直接请求 opencode.ai 获取配额和使用记录。

浏览器扩展不保存 cookie 明文，不连接本地后端。
