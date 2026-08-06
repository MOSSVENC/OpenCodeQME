# OpenCodeQME Architecture Review

## Scope

审计范围包括浏览器扩展、共享模块、构建脚本、测试脚本和仓库文档。目标是在不改变扩展功能的前提下清除冗余代码，并提高模块的内聚性与可维护性。

## Optimizations

- 新增 `extension/shared/ui.js`，集中 popup 与 tab 共用的 DOM、运行时消息、格式化与转义工具，删除两处重复实现。
- 将快照聚合收敛为 `HistoryStore.aggregateSnapshot(records)`，后台快照回退路径复用同一实现，删除 `background.js` 中的重复聚合函数。
- 清理 `HistoryStore` 中未被读取的 IndexedDB 同步状态、`meta` store 和未使用 API。
- 收敛 `OpenCodeFetcher` 的公开 API，只保留后台实际调用的账户识别、配额和用量查询。
- 删除未被 UI 或测试使用的 i18n key、CSS 旧样式和记录字段写入。
- 提取 `scripts/pack-crx.mjs`，让测试 CRX 与正式 release CRX 共用同一 Chromium 打包逻辑。
- 修正后台同步失败路径固定读取 `Default` 工作区的逻辑，改为使用当前同步工作区。

## Cohesion / Coupling Assessment

- `parsers`、`fetchers`、`history`、`i18n`、`ui`：高内聚，职责单一，主要依赖通过全局命名空间和明确消息接口暴露。
- `popup`、`tab`：视图内聚提高，公共能力不再重复实现，只保留各自页面渲染逻辑。
- `background`：仍承担同步编排、存储状态、快照刷新、闹钟和消息路由，属于中等内聚的 service worker 编排层；当前规模可接受，后续增长时可再拆分同步与设置模块。
- 构建脚本：正式版与测试版共享 CRX 打包 helper，降低脚本间重复与漂移风险。

## Verification

- 所有 JS/MJS 文件通过 `node --check`。
- `npm run test:extension` 通过，包含解析器与历史快照聚合测试。
- `./build-test.sh` 通过，可生成 zip 与 CRX。
- `./build.sh --suffix 0.1.1` 通过，确认正式 release zip 与 CRX 路径正常。
