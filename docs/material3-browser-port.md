# 68HUB Material 3 重构与单用户自动识别移植方案

## 1. 项目现状

当前 68HUB 是一个 Electron 应用：

- 前端：React 18 + Vite 5 + Tailwind 4 + daisyUI 5 + Recharts。
- 后端：Electron 主进程内嵌 Hono + better-sqlite3。
- 数据源：从 `opencode.ai` 抓取 OpenCode Go 配额和使用记录。
- 核心能力：额度总览、Token 统计、每日趋势、使用记录、自动同步与回填、中英文、明暗主题。
- 当前 UI 风格：daisyUI cupcake/forest，偏卡片式看板，不是 Material 3。

这次的目标是：

1. 用 Material 3（Material You）重构现有前端视觉与组件体系。
2. 只做单用户自动识别：浏览器打开 `opencode.ai` 时自动识别当前登录账户和工作区，不提供多账户管理和手动粘贴 cookie。
3. 优先做篡改猴脚本，因为单用户场景不需要常驻后台，交付最轻；MV3 扩展作为后续可选升级。
4. 尽量复用现有 React 页面、图表和业务逻辑，避免推倒重写。
5. 历史数据做完整保存：使用 IndexedDB 存全量使用记录，按 `usg_id` 去重，并保存同步断点。

## 2. 关键决策

### 2.1 本阶段主推篡改猴脚本

既然只做单用户自动识别，**篡改猴脚本比浏览器扩展更轻量**：

- 交付物是单个 `.user.js`，不需要 manifest、权限声明和安装目录。
- 运行在 `https://opencode.ai/*` 页面内，天然是 opencode.ai 同源，可以直接使用当前浏览器 cookie。
- 不需要 `cookies`、`alarms`、`sidePanel` 等扩展权限。
- 页面打开时自动识别账户并同步；页面关闭后停止刷新，但 IndexedDB 中的完整历史保留。

MV3 扩展仍然保留为后续可选升级：

- 如果之后需要页面关闭也能同步、全局 side panel、通知或浏览器 badge，再升级到扩展。
- 单用户版升级时不需要改 UI，只需要替换数据 adapter 和打包入口。

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
    history-store.ts      # IndexedDB 历史读写、去重、断点
    fetcher.ts            # DataProvider 接口
  adapters/
    electron.ts           # 现有 HTTP API，保留桌面端
    userscript.ts         # 主推：Tampermonkey 单用户自动识别 adapter
    extension.ts          # 后续可选：MV3 background message bridge
  ui/                    # 现有 React 页面与组件，按 M3 重构
web/
  userscript/
    index.ts              # 打包成单文件用户脚本，主交付物
  extension/
    manifest.json
    background.ts         # cookie、抓取、alarm、IndexedDB
    sidepanel.html
    popup.html
    options.html
    content-overlay.ts    # 可选：opencode.ai 浮层
```

核心原则：

- 抓取逻辑和解析逻辑只写一份，Electron 和浏览器共用。
- UI 只依赖 `DataProvider` 接口，不直接知道自己是 Electron、扩展还是用户脚本。
- 浏览器端先复用当前页面级功能，不复制 Electron 的托盘、原生窗口和登录窗口。
- 单用户版不保存、不读取任意 auth cookie，只使用浏览器当前会话。

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
- 设置：语言、主题、同步刷新间隔改成 M3 表单和 dialog；不再做账户管理和托盘设置。

## 5. 后续可选：MV3 浏览器扩展

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
  - 用 `chrome.cookies.get({ url: "https://opencode.ai", name: "auth" })` 读取当前登录 cookie。
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
- options：主题、语言、同步刷新间隔。
- 可选 content script：在 opencode.ai 页面右下角放一个 Material 3 浮层按钮，点击打开 side panel 或浮层详情。

### 5.4 与 Electron 的差异

- 浏览器端没有系统托盘；关闭 side panel 不等于退出应用。
- 浏览器端没有“重启后端”概念，改为“重连 / 重新同步”。
- 浏览器端不保存任意 auth cookie 字符串到普通本地文件，只读取浏览器当前会话 cookie。
- 扩展版仍然只做单用户自动识别，不引入多账户。

## 6. 主推：篡改猴单用户自动识别版

### 6.1 自动识别流程

1. 脚本只在 `https://opencode.ai/*` 页面运行。
2. 从当前 URL 自动提取工作区：
   - 例如 `/workspace/wrk_xxx/go` 中的 `wrk_xxx`。
   - 如果 URL 没有工作区，用当前会话 cookie 调用共享的 `resolveWorkspaceId('Default')`。
3. 不使用手动输入的 auth cookie，也不提供多账户切换。
4. 页面 cookie 自动随同源请求发送，脚本只负责解析结果。
5. 把识别到的账户信息保存为“当前账户”，后续页面打开时直接复用。

### 6.2 交付方式

1. 把 React 应用打包成单个 IIFE 用户脚本。
2. `@match https://opencode.ai/*`，注入一个固定定位的 Material 3 面板。
3. 脚本运行在 opencode.ai 同源页面，用页面 cookie 直接请求同源接口，规避跨域。
4. 用 `GM_getValue` / `GM_setValue` 保存设置和最近同步状态；完整历史使用 IndexedDB。
5. 页面打开时自动同步，页面关闭后不能保证继续同步。
6. 配额、使用记录 parser 与扩展共用同一份 domain 代码。

### 6.3 单用户自动识别 + 完整历史功能范围

- Dashboard：当前账户配额、今日 Token、最近使用记录。
- Token 统计：当前账户的模型用量排行。
- 每日趋势：当前账户的每日统计。
- 使用记录：完整历史分页、模型/日期统计，数据来自 IndexedDB。
- 设置：语言、主题、刷新间隔。
- 不保留：多账户列表、账户新增/删除/测试、自动回填配置、托盘。

### 6.4 完整历史存储设计

使用 IndexedDB 保存全量使用记录，不把完整历史塞进 `GM_getValue` 或 `chrome.storage.local`。

```ts
interface UsageRecord {
  usg_id: string;
  workspace_id: string;
  created_at: string;
  model: string;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  uncached_input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  key_id: string | null;
  plan: string | null;
  synced_at: string;
}

interface SyncState {
  workspace_id: string;
  deepest_page: number;
  last_sync_at: string;
  last_sync_status: 'ok' | 'error';
}
```

IndexedDB 设计：

- 表 `usage_records`，主键 `usg_id`，索引 `created_at` 和 `workspace_id`。
- 每次写入使用 upsert，重复 `usg_id` 直接覆盖，保证完整历史不膨胀。
- 表 `sync_state`，保存 `deepest_page`、`last_sync_at`、同步状态。
- 用户脚本运行在 opencode.ai 页面时，页面 IndexedDB 对脚本可用。
- 后续升级扩展时，把 IndexedDB 放到扩展后台，避免页面清理或 CSP 影响。

同步流程：

1. 读取 `sync_state` 中的 `deepest_page`。
2. 从第 0 页或断点继续拉取使用记录。
3. 对每页记录按 `usg_id` upsert 到 IndexedDB。
4. 如果某页记录全部已存在，停止增量同步。
5. 更新 `deepest_page` 和 `last_sync_at`。
6. 页面关闭后记录保留；下次打开继续从断点同步。

主要风险：

- 页面 CSP 可能阻止部分注入方式，需要预研。
- 脚本必须跟着 opencode.ai 页面结构变化更新。
- 页面关闭后不继续同步。

## 7. 单用户自动识别范围

本版明确不做多账户：

- 不使用 Electron 的账户列表。
- 不要求用户粘贴 auth cookie。
- 不支持 cookie 切换。
- 不做多账户筛选和“全账户汇总”。

自动识别的账户信息只保存当前会话信息；使用记录走完整历史 IndexedDB：

```ts
interface CurrentAccount {
  workspaceId: string;
  name: string;
  recognizedAt: string;
}
```

每次页面打开时：

1. 先读取 `chrome.storage` / `GM_getValue` 中的上次识别结果。
2. 从 URL 或当前 cookie 重新确认工作区。
3. 如果当前 cookie 已失效，显示“未登录 opencode.ai”，并引导用户重新登录。
4. 成功后刷新配额，并从断点继续同步完整使用记录。

## 8. 实施阶段

### Phase 0：现状冻结与基线

- 记录当前所有 API 返回结构和 UI 行为。
- 为 quota/usage parser 建立 fixture 测试，防止浏览器移植时抓取逻辑回归。
- 明确“完整桌面能力”和“单用户自动识别浏览器版”的边界。

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

### Phase 3：篡改猴单用户自动识别版

- 新增 Vite 用户脚本构建入口。
- 实现 `https://opencode.ai/*` 自动识别当前工作区。
- 实现 IndexedDB 完整历史存储、`usg_id` 去重、断点同步和手动回填。
- 用同一套 UI 和 domain 代码打包 `.user.js`。
- 验证 opencode.ai CSP 兼容性、浮层布局和同源抓取。

### Phase 4：MV3 扩展（可选）

- 如果之后需要常驻同步或全局 side panel，再升级。
- 实现 background service worker、IndexedDB、alarm 同步、cookie adapter。
- 在 Chrome/Edge 加载 unpacked 验证。

### Phase 5：发布与文档

- 补充构建脚本：
  - `pnpm build:extension`
  - `pnpm build:userscript`
- 补充安装说明、单用户自动识别说明和隐私说明。
- 跑一遍回归测试，输出发布包。

## 9. 验收标准

1. 现有页面在 Electron 和浏览器版中显示一致，无功能回退。
2. UI 明显符合 Material 3：正确使用 token、state layer、elevation、shape、type。
3. 用户脚本在打开 opencode.ai 时能自动识别当前登录账户和工作区。
4. 不要求用户手动输入 auth cookie，也不需要多账户管理。
5. 完整历史按 `usg_id` 去重，使用记录分页和统计均基于 IndexedDB。
6. 历史数据不会把 cookie 明文暴露给页面，页面关闭后历史仍保留。
7. 中英文、明暗主题、窄屏布局可用。

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| opencode.ai 页面结构改版，parser 失效 | parser 集中管理，加入 fixture 测试和版本记录 |
| 浏览器禁止设置 `Cookie`/`Origin` 等 header | 优先使用同源页面或扩展 cookie 能力，提前做兼容性 spike |
| MV3 service worker 生命周期短 | 使用 alarm + 打开 UI 时按需刷新，不做无限常驻轮询 |
| 历史使用记录体积大 | 使用 IndexedDB 存全量记录，不用 `chrome.storage`/GM 小存储承载历史 |
| 浏览器可能清理 IndexedDB | 用户脚本请求 `navigator.storage.persist()`；扩展版把 IndexedDB 放扩展后台 |
| 多账户需求 | 本版明确不做多账户；如未来需要再单独评估 cookie 切换或本地代理方案 |
| userscript 受页面 CSP 限制 | 先做最小注入验证，再决定是否保留 |
| 与 `@material/web` 集成成本 | 用 React wrapper 隔离；如果体积或事件绑定不合适，退化为 Tailwind M3 组件库 |

## 11. 当前实现状态

已完成轻量 MV3 扩展原型，入口为 `extension/`：

- `manifest.json`：MV3、popup、background service worker、alarms/cookies/storage 权限。
- `shared/parsers.js`：配额与使用记录 parser，从 Electron 后端逻辑迁移。
- `shared/fetchers.js`：同源抓取当前账户配额和使用记录。
- `shared/history.js`：IndexedDB 完整历史、`usg_id` 去重、同步断点。
- `background.js`：后台直接抓取、alarm 定时同步、快照缓存、badge、设置持久化。
- `popup.html/css/js`：Material 3 弹窗，包含总览、历史、设置和动画。

构建与验证：

```bash
npm run test:extension
npm run build:extension
npm run mock:opencode
```

构建产物为 `release/opencodeqme-extension.zip`，也可直接加载 `extension/` 目录。

当前边界：

- 只支持浏览器当前登录的单个 opencode.ai 账户。
- 后台自动同步，不需要打开 opencode.ai 页面。
- 使用记录默认按上游 5 分钟同步，配额默认 60 秒刷新。
