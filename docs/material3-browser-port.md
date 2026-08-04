# 68HUB Material 3 重构与浏览器移植方案

## 1. 项目现状

当前 68HUB 是一个 Electron 应用：

- 前端：React 18 + Vite 5 + Tailwind 4 + daisyUI 5 + Recharts。
- 后端：Electron 主进程内嵌 Hono + better-sqlite3。
- 数据源：从 `opencode.ai` 抓取 OpenCode Go 配额和使用记录。
- 核心能力：多账户管理、额度总览、Token 统计、每日趋势、使用记录、自动同步与回填、中英文、明暗主题。
- 当前 UI 风格：daisyUI cupcake/forest，偏卡片式看板，不是 Material 3。

这次的目标是：

1. 用 Material 3（Material You）重构现有前端视觉与组件体系。
2. 把项目移植到浏览器，优先做成 Chrome/Edge MV3 浏览器扩展；保留篡改猴脚本作为轻量方案。
3. 尽量复用现有 React 页面、图表和业务逻辑，避免推倒重写。

## 2. 关键决策

### 2.1 浏览器扩展优先，篡改猴脚本作为轻量变体

建议主目标是 **MV3 浏览器扩展**，原因：

- 扩展有独立后台（service worker），可以用 `chrome.alarms` 定时同步。
- 可以用 `chrome.storage` 或扩展页 IndexedDB 保存历史数据。
- 可以做 side panel、popup、badge、通知、options 页，体验接近桌面应用。
- 能申请 `cookies` 权限读取当前登录的 `opencode.ai` cookie。
- 不受页面 CSP 和页面 DOM 改版影响。

篡改猴脚本更适合：

- 快速在 `https://opencode.ai/*` 上注入一个 Material 3 浮层。
- 只展示当前账号配额和最近使用记录。
- 不需要安装扩展，也不需要浏览器商店。

不建议把篡改猴脚本做成完整替代品，因为它没有可靠的常驻后台，页面关闭后无法继续自动同步，且多账户支持更弱。

### 2.2 视觉基线采用 Material 3

“最新风格”按 **Material Design 3 / Material You** 执行：

- Color：primary、onPrimary、primaryContainer、secondaryContainer、surface、surfaceContainer、outline、error 等 token。
- Shape：小 8px、中 12px、大 16px、超大 28px。
- State：hover、pressed、focus、dragged 状态层。
- Elevation：按层级的 tonal shadow。
- Type：使用 Material 字体分级；中文正文建议叠加 Noto Sans SC，品牌字仅用于 Logo。
- Motion：使用标准/强调缓动，控制重绘与图表动画。

### 2.3 UI 技术路线

保留 React、Vite、Recharts，移除 daisyUI 组件样式，改为：

- 引入 `@material/web` 官方 Material 3 Web Components，用于按钮、文本输入框、选择菜单、对话框、Switch、Segmented Button、Progress、Tabs 等。
- 对 Web Components 封装 React 薄层，保持页面内 API 一致。
- 数据表、图表容器、页面布局继续用 React + Tailwind 工具类实现，但颜色和形状全部接 M3 token。
- 保持现有 i18n、主题 provider、轮询 hook 和路由结构，只替换视觉层。

如果后续发现 `@material/web` 与 Recharts 或 side panel 体积冲突，可以退化为“Tailwind + 自定义 M3 组件库”，但视觉规范不变。

## 3. 目标架构

```
src/
  domain/
    types.ts              # 从 src/api/types.ts 提升为共享 DTO
    quota-parser.ts       # 从 electron/backend/quota.ts 提取纯函数
    usage-parser.ts       # 从 electron/backend/opencode-usage.ts 提取
    analytics.ts          # 配额级联、聚合、统计
    storage.ts            # StorageProvider 接口
    fetcher.ts            # DataProvider 接口
  adapters/
    electron.ts           # 现有 HTTP API，保留桌面端
    extension.ts          # MV3 background message bridge
    userscript.ts         # 可选 Tampermonkey adapter
  ui/                    # 现有 React 页面与组件，按 M3 重构
web/
  extension/
    manifest.json
    background.ts         # cookie、抓取、alarm、IndexedDB
    sidepanel.html
    popup.html
    options.html
    content-overlay.ts    # 可选：opencode.ai 浮层
  userscript/
    index.ts              # 可选：打包成单文件用户脚本
```

核心原则：

- 抓取逻辑和解析逻辑只写一份，Electron 和浏览器共用。
- UI 只依赖 `DataProvider` 接口，不直接知道自己是 Electron、扩展还是用户脚本。
- 浏览器端先复用当前页面级功能，不复制 Electron 的托盘、原生窗口和登录窗口。

## 4. Material 3 重构范围

### 4.1 设计 Token

新增 `src/styles/material3.css`，用 CSS 变量定义：

```css
:root {
  --md-sys-color-primary: #006a6a;
  --md-sys-color-on-primary: #ffffff;
  --md-sys-color-primary-container: #6ff7f6;
  --md-sys-color-on-primary-container: #002020;
  --md-sys-color-surface: #fafdfc;
  --md-sys-color-surface-container: #eef1f0;
  --md-sys-color-surface-container-high: #e8ebea;
  --md-sys-color-outline: #6f7978;
  --md-sys-color-error: #ba1a1a;
  --md-sys-shape-corner-small: 8px;
  --md-sys-shape-corner-medium: 12px;
  --md-sys-shape-corner-large: 16px;
  --md-sys-shape-corner-extra-large: 28px;
}
```

明暗主题共用同一套 token，暗色模式通过 `data-theme="dark"` 覆盖。

### 4.2 组件替换清单

| 现有 daisyUI / 自定义元素 | Material 3 目标 |
|---|---|
| `btn` | `md-filled-button`、`md-outlined-button`、`md-text-button` |
| `input` | `md-outlined-text-field` |
| `select` | `md-outlined-select` |
| `dialog modal` | `md-dialog` |
| `toggle` | `md-switch` |
| `tabs` / 时间范围按钮 | `md-segmented-button` 或 M3 Tabs |
| `badge` | M3 tonal chip |
| `card` | M3 outlined/elevated card |
| 侧边导航 | M3 Navigation Rail（桌面）/ Navigation Drawer（窄屏） |
| 顶部窗口栏 | M3 Top App Bar（浏览器无 Electron 拖拽区） |
| Toast | M3 Snackbar |
| Loading | M3 Linear Progress |
| 数据表 | M3 Data Table 样式，不用原生 select/table 风格堆叠 |

### 4.3 页面视觉改造

- Dashboard：顶部 KPI 使用 M3 card 或 list；配额进度条使用 M3 Linear Progress；Top 3 模型改用更紧凑的 donut + model chip。
- Token 统计：汇总卡片、模型排行图表、M3 Data Table。
- 每日趋势：日期选择器改为 M3 控件，统计表保留可读性。
- 使用记录：分页、筛选、缓存 Token tooltip 全部保留，但使用 M3 table 和 snackbar。
- 设置：语言、主题、账户、同步、回填、托盘等设置页改成 M3 表单和 dialog。

## 5. 浏览器扩展方案

### 5.1 Manifest V3 草案

```json
{
  "manifest_version": 3,
  "name": "68HUB",
  "version": "0.1.0",
  "permissions": [
    "alarms",
    "cookies",
    "notifications",
    "sidePanel",
    "storage"
  ],
  "host_permissions": [
    "https://opencode.ai/*",
    "https://auth.opencode.ai/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "options_page": "options.html"
}
```

### 5.2 数据层

- 扩展后台 service worker 作为唯一数据入口。
- 当前账号认证：
  - 优先用 `chrome.cookies.get({ url: "https://opencode.ai", name: "auth" })` 读取当前登录 cookie。
  - 或尝试 `fetch(url, { credentials: "include" })` 带浏览器 cookie 请求 opencode.ai。
- 配额：请求 `https://opencode.ai/workspace/{workspaceId}/go`，复用共享 parser。
- 使用记录：请求 `https://opencode.ai/_server?id=...&args=...`，复用共享 parser。
- 历史数据：写入扩展 IndexedDB，不把大量使用记录塞进 `chrome.storage`。
- 设置与账户元数据：写入 `chrome.storage.local`。
- 自动同步：用 `chrome.alarms` 每 1 到 5 分钟唤醒一次，避免依赖常驻 service worker。
- 首次同步：可以在 side panel 打开时同步最近 30 页，再让用户手动回填。

### 5.3 UI 入口

- side panel：完整 Dashboard，推荐作为主界面。
- popup：精简摘要，展示配额、今日 Token 和同步状态。
- options：账户、主题、语言、同步策略。
- 可选 content script：在 opencode.ai 页面右下角放一个 Material 3 浮层按钮，点击打开 side panel 或浮层详情。

### 5.4 与 Electron 的差异

- 浏览器端没有系统托盘；关闭 side panel 不等于退出应用。
- 浏览器端没有“重启后端”概念，改为“重连 / 重新同步”。
- 浏览器端不保存任意 auth cookie 字符串到普通本地文件，只读取浏览器当前会话 cookie。
- Electron 多账户能力在浏览器端需要重新设计，见第 7 节。

## 6. 篡改猴脚本方案

如果要做轻量版：

1. 把 React 应用打包成单个 IIFE 用户脚本。
2. `@match https://opencode.ai/*`，注入一个固定定位的 Material 3 面板。
3. 脚本运行在 opencode.ai 同源页面，用页面 cookie 直接请求同源接口，规避跨域。
4. 用 `GM_getValue` / `GM_setValue` 保存设置和最近同步状态；完整历史仍建议 IndexedDB。
5. 页面打开时自动同步，页面关闭后不能保证继续同步。
6. 配额、使用记录 parser 与扩展共用同一份 domain 代码。

主要风险：

- 页面 CSP 可能阻止部分注入方式，需要预研。
- 脚本必须跟着 opencode.ai 页面结构变化更新。
- 多账户和常驻同步能力弱。

## 7. 多账户策略

现状 Electron 通过存储多个 `auth_cookie` 实现多账户。浏览器 fetch 无法直接设置 `Cookie` 请求头，因此浏览器端不能简单照搬。

建议分三步：

1. V1：只支持浏览器当前登录账户。扩展读取当前 `auth` cookie，不要求用户粘贴 cookie，最安全也最稳。
2. V2：支持多个“浏览器 profile / 容器账户”的元数据，如 Chrome profile、Firefox container、账号备注，但不切换系统登录态。
3. V3：如果必须支持任意 auth cookie 多账户，采用显式开启的“cookie 切换模式”：
   - 请求前用 `chrome.cookies.set` 临时写入目标账户 cookie；
   - 请求后恢复原 cookie；
   - 存在打断用户当前登录态的风险，必须做成可选项并做确认提示。

不推荐把 cookie 切换做成默认行为，也不推荐用本地代理冒充纯浏览器扩展。

## 8. 实施阶段

### Phase 0：现状冻结与基线

- 记录当前所有 API 返回结构和 UI 行为。
- 为 quota/usage parser 建立 fixture 测试，防止浏览器移植时抓取逻辑回归。
- 明确“完整桌面能力”和“浏览器版能力”的边界。

### Phase 1：共享核心抽取

- 将 `src/api/types.ts` 提升为 `src/domain/types.ts`。
- 将 `electron/backend/quota.ts`、`opencode-usage.ts` 的解析函数迁移到 domain。
- 将 `analytics.ts` 的级联和聚合逻辑迁移到 domain。
- 定义 `DataProvider` 接口，先让 Electron 后端继续可用。
- 验收：现有 `pnpm dev` 无行为回归。

### Phase 2：Material 3 视觉重构

- 引入 M3 token 和 `@material/web`。
- 移除 daisyUI 组件类，替换所有页面。
- 逐页验收 Dashboard、Token 统计、每日趋势、使用记录、设置、关于。
- 验收：明暗主题、中英文、响应式布局、可访问性都通过。

### Phase 3：MV3 扩展

- 新增 Vite 多入口构建。
- 实现 background service worker、IndexedDB、alarm 同步、cookie adapter。
- 实现 side panel、popup、options。
- 在 Chrome/Edge 加载 unpacked 验证。

### Phase 4：轻量用户脚本（可选）

- 如果确认需要，用同一套 UI 和 domain 代码打包 userscript。
- 验证 opencode.ai CSP 兼容性、浮层布局和同源抓取。

### Phase 5：发布与文档

- 补充构建脚本：
  - `pnpm build:extension`
  - `pnpm build:userscript`
- 补充安装、权限说明、多账户限制和隐私说明。
- 跑一遍回归测试，输出发布包。

## 9. 验收标准

1. 现有页面在 Electron 和浏览器扩展中显示一致，无功能回退。
2. UI 明显符合 Material 3：正确使用 token、state layer、elevation、shape、type。
3. 扩展能读取当前登录账户、拉取配额和最近使用记录。
4. 自动同步在 service worker 被回收后仍能通过 alarm 恢复。
5. 历史数据不会超过浏览器存储限制，不会把 cookie 明文暴露给页面。
6. 中英文、明暗主题、窄屏布局可用。

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| opencode.ai 页面结构改版，parser 失效 | parser 集中管理，加入 fixture 测试和版本记录 |
| 浏览器禁止设置 `Cookie`/`Origin` 等 header | 优先使用同源页面或扩展 cookie 能力，提前做兼容性 spike |
| MV3 service worker 生命周期短 | 使用 alarm + 打开 UI 时按需刷新，不做无限常驻轮询 |
| 历史使用记录体积大 | 使用 IndexedDB，限制同步页数，提供回填入口 |
| 多账户 cookie 切换打断登录 | V1 只支持当前账户；cookie 切换做成显式实验功能 |
| userscript 受页面 CSP 限制 | 先做最小注入验证，再决定是否保留 |
| 与 `@material/web` 集成成本 | 用 React wrapper 隔离；如果体积或事件绑定不合适，退化为 Tailwind M3 组件库 |
