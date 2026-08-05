# OpenCode 用量字段说明

本文记录 OpenCodeQME 对 opencode.ai 用量字段的解析口径，以及从官网原始响应和上游 68hub 得到的设计结论。

## 原始字段

OpenCode 的 `_server` 使用记录原始响应包含以下主要字段：

| 字段 | 含义 | 当前处理 |
| --- | --- | --- |
| `inputTokens` | 未缓存输入 token | 保存为 `uncached_input_tokens` |
| `outputTokens` | 输出 token | 保存为 `output_tokens` |
| `reasoningTokens` | 推理 token | 当前未单独解析 |
| `cacheReadTokens` | 缓存读取 token | 保存为 `cache_read_tokens` |
| `cacheWrite5mTokens` | 5 分钟缓存写入 token | 可空，`null` 转为 0 |
| `cacheWrite1hTokens` | 1 小时缓存写入 token | 可空，`null` 转为 0 |
| `cost` | 原始费用 | 保存为 `cost_raw` |

`cost_usd` 按上游逻辑计算：

```text
cost_usd = cost / 1_000_000_000
```

## 展示口径

按照上游 [68hub](https://github.com/evanfu0110/68hub) 的逻辑，前端展示的“输入”是总输入：

```text
输入 = inputTokens + cacheReadTokens + cacheWrite5mTokens + cacheWrite1hTokens
```

当前扩展保存的字段关系：

```text
input_tokens = uncached_input_tokens + cache_read_tokens + cache_write_tokens
```

## 为什么缓存写入经常为 0

从 opencode.ai 官网原始响应抓取到的 4503 条记录中，所有模型均为：

```text
cacheWrite5mTokens: null
cacheWrite1hTokens: null
```

涉及模型包括：

- `deepseek-v4-flash`
- `deepseek-v4-flash-free`
- `mimo-v2.5-free`
- `laguna-s-2.1-free`
- `ling-3.0-flash-free`
- `north-mini-code-free`

结论：

- 字段存在，但 OpenCode 将缓存写入字段设计为可空字段。
- 当前这些 provider/model 没有上报缓存写入 token，因此官网返回 `null`。
- 扩展把 `null` 解析为 `0` 是正确的，不是抓取失败，也不是解析 bug。
- `cacheWrite` 无法从 `inputTokens` 或 `cacheReadTokens` 间接计算出来，它依赖 provider 是否上报独立计数。

## 官方前端证据

OpenCode 官方前端 i18n 中存在以下字段：

```text
workspace.usage.breakdown.input
workspace.usage.breakdown.cacheRead
workspace.usage.breakdown.cacheWrite
workspace.usage.breakdown.output
workspace.usage.breakdown.reasoning
```

说明官网 UI 本身支持展示缓存写入，只是当前数据源没有提供非空值。
