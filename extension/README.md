# OpenCodeQME Extension

OpenCodeQME 全称是 **OpenCode Quota Monitor Extension**，轻量 MV3 浏览器扩展：单用户自动识别、Material 3 风格、IndexedDB 完整历史。

## 功能

- 后台自动识别当前浏览器登录的 OpenCode Go 账户和工作区，不需要打开 opencode.ai 页面。
- 自动拉取 OpenCode Go 配额、使用记录，并用 `usg_id` 去重写入 IndexedDB。
- 使用记录按上游默认每 5 分钟同步，配额按默认 60 秒刷新。
- 记录同步断点，后台继续回填完整历史。
- popup 提供小窗口预览：今日 Token、可用额度、最近记录和同步状态。
- 独立标签页提供完整界面：总览、Token 统计、每日趋势、使用记录和设置。
- 页面边缘悬浮按钮可拖动并自动吸附左右边缘，点击按当前 `uiMode` 打开小窗口或标签页。
- `uiMode` 会持久化到 `chrome.storage.local`，下次打开时沿用上次选择的模式。

## 安装

1. 打开 Chrome/Edge 的 `chrome://extensions`。
2. 开启“开发者模式”。
3. 自用推荐两种方式：
   - 将 `release/opencodeqme-extension.crx` 拖入 `chrome://extensions` 安装。
   - 或点击“加载已解压的扩展程序”，选择本项目中的 `extension` 目录。
4. 在浏览器中登录一次 `https://opencode.ai`，之后不需要保持页面打开。
5. 扩展后台会自动识别账户并同步。

> `.crx` 使用 `release/opencodeqme-extension.pem` 签名；请自行保留该私钥，不要提交到仓库。丢失后重新打包会导致扩展 ID 改变。

## 权限说明

- `storage`：保存当前账户、设置和同步快照。
- `alarms`：定时唤醒后台执行同步。
- `cookies`：检查当前 opencode.ai 登录状态。
- `https://opencode.ai/*`：允许后台直接请求 opencode.ai 获取配额和使用记录。

浏览器扩展不保存 cookie 明文，不连接本地后端。
