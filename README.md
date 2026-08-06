# OpenCodeQME

OpenCodeQME 全称是 **OpenCode Quota Monitor Extension**，用于监控 OpenCode 工作区配额和用量。

## 来源与改动

- 上游：[68HUB](https://github.com/evanfu0110/68hub)，作者 `evanfu0110`。
- 本项目将上游 68HUB 移植为独立 MV3 浏览器扩展，已移除 Electron/React 应用、旧素材和上游构建流程。
- 当前仓库只保留浏览器扩展，并在此基础上新增工具栏简略窗口、独立详情页、中英文界面、完整历史同步和 CRX 打包。

## 功能

- 小窗口预览：点击浏览器工具栏中的扩展图标打开，展示今日 Token、可用额度、最近记录、同步状态。
- 独立标签页：从小窗口进入，包含总览、Token 统计、每日趋势、使用记录、设置。
- 中英文界面切换，并记住上次选择的语言。
- 后台自动同步完整使用记录，数据保存在本地 IndexedDB。

## 安装

1. 打开 Chrome/Edge 的 `chrome://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，加载 `extension` 目录。

也可以使用 `release/opencodeqme-extension-0.1.1.crx` 安装。

## 构建

```bash
./build-test.sh
./build.sh
```

- `./build-test.sh` 输出到 `release-test/opencodeqme-extension.zip` 和 `release-test/opencodeqme-extension.crx`，不带版本后缀，不改版本号。
- `./build.sh` 会先显示当前版本，再在终端输入下一个版本号（直接回车保持当前版本），确认后自动更新 `extension/manifest.json` 和 `package.json`，并按该版本号输出 `release/opencodeqme-extension-<version>.zip` 和 `release/opencodeqme-extension-<version>.crx`。
- 自动化构建可用 `OPENCODE_RELEASE_SUFFIX=0.1.1 ./build.sh` 跳过交互确认。
