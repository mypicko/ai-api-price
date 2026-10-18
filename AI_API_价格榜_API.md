# AI API 价格榜 · 数据接口文档（API）

| 项       | 内容                                         |
| -------- | -------------------------------------------- |
| 文档版本 | v1.1（新增视频/图像接口）                    |
| 接口版本 | `v1`                                         |
| 创建日期 | 2026-10-18                                   |
| 配套文档 | `DEV_DOCUMENT.md` · `AI_API_价格榜_STYLE.md` |

本项目是纯静态网站，没有后端服务器。下面说的"接口"有两种：

1. **公开数据接口**（§2）：构建时生成的静态 JSON/RSS 文件，任何人都可以用 `GET` 直接读取，供其他程序调用。
2. **内部接口**（§3）：管线内部的 TypeScript 契约（Source、Notifier）和命令行工具，供开发者扩展用。

---

## 目录

1. [通用约定](#1-通用约定)
2. [公开数据接口](#2-公开数据接口)
   - 2.1 `GET /api/v1/latest.json` 全部当前报价
   - 2.2 `GET /api/v1/providers.json` 厂商与平台
   - 2.3 `GET /api/v1/models/{vendor}/{model}.json` 单个模型详情与历史
   - 2.4 `GET /api/v1/changes.json` 最近变动
   - 2.5 `GET /api/v1/changes/{YYYY-MM}.json` 按月变动
   - 2.6 `GET /api/v1/fx.json` 汇率
   - 2.7 `GET /api/v1/status.json` 数据源健康状态
   - 2.8 `GET /rss.xml` · `GET /en/rss.xml` RSS 订阅
   - 2.9 `GET /api/v1/media.json` 视频/图像生成报价（1.1）
   - 2.10 `GET /api/v1/media/changes.json` 视频/图像最近变动（1.1）
3. [内部接口](#3-内部接口)
   - 3.1 Source 抓取器契约
   - 3.2 Notifier 推送契约
   - 3.3 命令行（CLI）
   - 3.4 配置文件格式
4. [错误码](#4-错误码)
5. [变更记录](#5-变更记录)

---

## 1. 通用约定

### 1.1 基础地址

```
https://<SITE_URL><BASE_PATH>api/v1/
例：https://alice.github.io/ai-api-price/api/v1/latest.json
```

### 1.2 统一响应格式

所有 JSON 接口都使用同一个外层结构：

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {
    "schemaVersion": "1.0.0",
    "generatedAt": "2026-10-19T00:04:12Z",
    "dataDate": "2026-10-19",
    "count": 412
  }
}
```

| 字段                 | 类型           | 说明                                                                                |
| -------------------- | -------------- | ----------------------------------------------------------------------------------- |
| `success`            | boolean        | 静态文件始终是 `true`；文件不存在时由 Pages 直接返回 HTTP 404                       |
| `data`               | object / array | 实际数据                                                                            |
| `error`              | null           | 预留字段，与项目统一的响应格式保持一致                                              |
| `meta.schemaVersion` | semver         | 字段结构版本。加字段 → minor +1；删除或改名字段 → major +1，同时启用新的 `/api/v2/` |
| `meta.generatedAt`   | ISO 8601 UTC   | 文件生成时间                                                                        |
| `meta.dataDate`      | `YYYY-MM-DD`   | 数据对应的日期（北京时间）                                                          |
| `meta.count`         | int            | 列表类接口的条目数                                                                  |

### 1.3 字段约定

| 约定        | 说明                                                                 |
| ----------- | -------------------------------------------------------------------- |
| 价格单位    | **每百万 token（per 1M tokens）**                                    |
| 价格 `null` | 未知或该厂商不提供（例如没有缓存价）                                 |
| 价格 `0`    | 免费                                                                 |
| 原币种      | `currency` 字段（`USD` / `CNY`）；变动检测按原币种比较               |
| 换算价格    | `converted.usd` / `converted.cny`，使用 `meta.fxRate` 换算，仅供参考 |
| 时间        | ISO 8601 UTC                                                         |
| ID          | `vendor`、`model`、`platform` 均为小写，由 `[a-z0-9.-]` 组成         |

### 1.4 HTTP 行为

| 项       | 说明                                                                           |
| -------- | ------------------------------------------------------------------------------ |
| 方法     | 只支持 `GET` / `HEAD`                                                          |
| 跨域     | GitHub Pages 默认返回 `Access-Control-Allow-Origin: *`，浏览器端可以直接 fetch |
| 缓存     | Pages 默认 `Cache-Control: max-age=600`；数据每天更新一次                      |
| 频率限制 | 没有限制，但请缓存结果，每天读取一次就够了                                     |
| 压缩     | 支持 gzip                                                                      |

---

## 2. 公开数据接口

### 2.1 `GET /api/v1/latest.json` — 全部当前报价

返回所有**当前在售**的报价（`status = active | missing`），不包含已下架的。

**请求示例**

```bash
curl -s https://alice.github.io/ai-api-price/api/v1/latest.json | jq '.data.offerings | length'
```

**响应示例**

```json
{
  "success": true,
  "data": {
    "offerings": [
      {
        "id": "official:deepseek/deepseek-chat",
        "vendor": "deepseek",
        "model": "deepseek-chat",
        "modelSlug": "deepseek/deepseek-chat",
        "displayName": "DeepSeek-V3",
        "platform": "official",
        "source": "deepseek",
        "currency": "CNY",
        "input": 2.0,
        "output": 8.0,
        "cacheRead": 0.5,
        "cacheWrite": null,
        "tiers": null,
        "converted": {
          "usd": { "input": 0.2817, "output": 1.1268, "cacheRead": 0.0704, "cacheWrite": null },
          "cny": { "input": 2.0, "output": 8.0, "cacheRead": 0.5, "cacheWrite": null }
        },
        "blended": { "usd": 0.493, "cny": 3.5 },
        "contextWindow": 128000,
        "maxOutput": 8192,
        "isFree": false,
        "stale": false,
        "status": "active",
        "change7d": { "input": 0, "output": -0.5 },
        "sourceUrl": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
        "notes": "北京时间 00:30-08:30 错峰时段另有优惠",
        "fetchedAt": "2026-10-19T00:01:33Z",
        "publishedAt": "2026-10-19T00:04:12Z"
      }
    ]
  },
  "error": null,
  "meta": {
    "schemaVersion": "1.0.0",
    "generatedAt": "2026-10-19T00:04:12Z",
    "dataDate": "2026-10-19",
    "count": 412,
    "fxRate": { "usdCny": 7.1, "date": "2026-10-18", "provider": "frankfurter" }
  }
}
```

> 示例里的数字只是为了说明格式，不代表真实价格。

**Offering 字段说明**

| 字段            | 类型                      | 可空 | 说明                                                                         |
| --------------- | ------------------------- | ---- | ---------------------------------------------------------------------------- |
| `id`            | string                    | ❌   | `platform:vendor/model`，全局唯一                                            |
| `vendor`        | string                    | ❌   | 模型研发厂商 ID，见 `providers.json`                                         |
| `model`         | string                    | ❌   | 规范化后的模型 ID                                                            |
| `modelSlug`     | string                    | ❌   | `vendor/model`，对应详情接口路径                                             |
| `displayName`   | string                    | ❌   | 展示名称                                                                     |
| `platform`      | string                    | ❌   | 售卖平台：`official`（厂商直供）/ `openrouter` / `siliconflow`               |
| `source`        | string                    | ❌   | 数据由哪个抓取器提供                                                         |
| `currency`      | `"USD"` \| `"CNY"`        | ❌   | 原币种                                                                       |
| `input`         | number                    | ✅   | 输入价，每百万 token                                                         |
| `output`        | number                    | ✅   | 输出价                                                                       |
| `cacheRead`     | number                    | ✅   | 缓存命中（读取）价                                                           |
| `cacheWrite`    | number                    | ✅   | 缓存写入价                                                                   |
| `tiers`         | Tier[]                    | ✅   | 阶梯价，见下表；有阶梯价时顶层价格 = 第一档                                  |
| `converted`     | object                    | ❌   | 按当日汇率换算的 USD/CNY 价格                                                |
| `blended`       | object                    | ✅   | 混合价 `(3×input + output)/4`，用于默认排序；input 或 output 缺失时为 `null` |
| `contextWindow` | int                       | ✅   | 上下文长度（token）                                                          |
| `maxOutput`     | int                       | ✅   | 最大输出（token）                                                            |
| `isFree`        | boolean                   | ❌   | 输入、输出价都是 0                                                           |
| `stale`         | boolean                   | ❌   | `true` = 本次抓取失败，显示的是上次成功的数据                                |
| `status`        | `"active"` \| `"missing"` | ❌   | `missing` = 最近 1~2 天没抓到，但还没判定下架                                |
| `change7d`      | object                    | ✅   | 与 7 天前相比的相对变化（`-0.5` = 降价 50%），没有变化的字段为 `0`           |
| `sourceUrl`     | string                    | ❌   | 证据链接（https，白名单域名）                                                |
| `notes`         | string                    | ✅   | 备注，≤ 200 字符，纯文本                                                     |
| `fetchedAt`     | datetime                  | ❌   | 最近一次成功抓取的时间                                                       |
| `publishedAt`   | datetime                  | ❌   | 发布到网站的时间                                                             |

**Tier 字段**

| 字段                                            | 类型           | 说明                                    |
| ----------------------------------------------- | -------------- | --------------------------------------- |
| `minInputTokens`                                | int            | 本档起点（含），单次请求的输入 token 数 |
| `maxInputTokens`                                | int \| null    | 本档终点（不含），`null` = 无上限       |
| `input` / `output` / `cacheRead` / `cacheWrite` | number \| null | 本档价格                                |

```json
"tiers": [
  { "minInputTokens": 0,      "maxInputTokens": 128000, "input": 0.8, "output": 2.0, "cacheRead": null, "cacheWrite": null },
  { "minInputTokens": 128000, "maxInputTokens": null,   "input": 2.4, "output": 6.0, "cacheRead": null, "cacheWrite": null }
]
```

---

### 2.2 `GET /api/v1/providers.json` — 厂商与平台

```json
{
  "success": true,
  "data": {
    "vendors": [
      {
        "id": "anthropic",
        "nameZh": "Anthropic",
        "nameEn": "Anthropic",
        "region": "intl",
        "website": "https://www.anthropic.com",
        "logo": "/logos/anthropic.svg",
        "modelCount": 14,
        "mediaModelCount": 0
      },
      {
        "id": "alibaba",
        "nameZh": "阿里通义",
        "nameEn": "Alibaba Qwen",
        "region": "cn",
        "website": "https://bailian.console.aliyun.com",
        "logo": "/logos/alibaba.svg",
        "modelCount": 38,
        "mediaModelCount": 11
      }
    ],
    "platforms": [
      { "id": "official", "nameZh": "官方", "nameEn": "Official", "website": null },
      {
        "id": "openrouter",
        "nameZh": "OpenRouter",
        "nameEn": "OpenRouter",
        "website": "https://openrouter.ai"
      },
      {
        "id": "siliconflow",
        "nameZh": "硅基流动",
        "nameEn": "SiliconFlow",
        "website": "https://siliconflow.cn"
      }
    ]
  },
  "error": null,
  "meta": {
    "schemaVersion": "1.0.0",
    "generatedAt": "2026-10-19T00:04:12Z",
    "dataDate": "2026-10-19",
    "count": 18
  }
}
```

| 字段              | 说明                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------ |
| `region`          | `intl` 国际 / `cn` 国内                                                              |
| `modelCount`      | 当前在售的模型数（去重后，不按平台重复计数）                                         |
| `mediaModelCount` | 当前在售的视频/图像生成模型数（1.1 新增）；只有视频/图像模型的厂商 `modelCount` 为 0 |

---

### 2.3 `GET /api/v1/models/{vendor}/{model}.json` — 单个模型详情与历史

**路径参数**

| 参数     | 示例                | 说明    |
| -------- | ------------------- | ------- |
| `vendor` | `anthropic`         | 厂商 ID |
| `model`  | `claude-sonnet-4-5` | 模型 ID |

**请求示例**

```bash
curl -s https://alice.github.io/ai-api-price/api/v1/models/deepseek/deepseek-chat.json
```

**响应示例**

```json
{
  "success": true,
  "data": {
    "model": {
      "slug": "deepseek/deepseek-chat",
      "vendor": "deepseek",
      "displayName": "DeepSeek-V3",
      "contextWindow": 128000,
      "maxOutput": 8192,
      "modalities": ["text"],
      "firstSeenAt": "2026-10-19",
      "status": "active"
    },
    "offerings": [
      {
        "id": "official:deepseek/deepseek-chat",
        "platform": "official",
        "currency": "CNY",
        "input": 2.0,
        "output": 8.0,
        "...": "同 latest.json 的 Offering"
      },
      {
        "id": "openrouter:deepseek/deepseek-chat",
        "platform": "openrouter",
        "currency": "USD",
        "input": 0.3,
        "output": 1.2,
        "...": "..."
      }
    ],
    "history": {
      "official:deepseek/deepseek-chat": [
        {
          "effectiveDate": "2026-10-19",
          "input": 2.0,
          "output": 16.0,
          "cacheRead": 0.5,
          "cacheWrite": null
        },
        {
          "effectiveDate": "2026-11-02",
          "input": 2.0,
          "output": 8.0,
          "cacheRead": 0.5,
          "cacheWrite": null
        }
      ]
    },
    "changes": [
      {
        "id": "2026-11-02-official:deepseek/deepseek-chat-1",
        "type": "price_down",
        "offeringId": "official:deepseek/deepseek-chat",
        "fields": [{ "field": "output", "old": 16.0, "new": 8.0, "pct": -0.5 }],
        "currency": "CNY",
        "confirmedFromQuarantine": false,
        "detectedAt": "2026-11-02T00:02:10Z"
      }
    ]
  },
  "error": null,
  "meta": {
    "schemaVersion": "1.0.0",
    "generatedAt": "2026-11-02T00:04:12Z",
    "dataDate": "2026-11-02"
  }
}
```

**history 说明**

- 按 Offering 分组，是**变更点序列**：只有价格变化的那天才有一个点，相邻两点之间价格不变
- 画走势图时用"阶梯线"（step line）：每个点的值一直延续到下一个点
- 已下架的模型（`status = removed`）也会保留这个文件，历史不会删除

**错误**

| 情况       | 结果                                             |
| ---------- | ------------------------------------------------ |
| 模型不存在 | HTTP 404（Pages 返回网站的 404 页面，不是 JSON） |

---

### 2.4 `GET /api/v1/changes.json` — 最近变动

返回**最近 90 天**的全部变动事件，按 `detectedAt` 倒序排列。

```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "2026-11-02-official:deepseek/deepseek-chat-1",
        "type": "price_down",
        "offeringId": "official:deepseek/deepseek-chat",
        "vendor": "deepseek",
        "modelSlug": "deepseek/deepseek-chat",
        "displayName": "DeepSeek-V3",
        "platform": "official",
        "currency": "CNY",
        "fields": [{ "field": "output", "old": 16.0, "new": 8.0, "pct": -0.5 }],
        "confirmedFromQuarantine": false,
        "detectedAt": "2026-11-02T00:02:10Z"
      },
      {
        "id": "2026-11-02-openrouter:x-ai/grok-5-1",
        "type": "new_model",
        "offeringId": "openrouter:x-ai/grok-5",
        "vendor": "x-ai",
        "modelSlug": "x-ai/grok-5",
        "displayName": "Grok 5",
        "platform": "openrouter",
        "currency": "USD",
        "fields": [],
        "confirmedFromQuarantine": false,
        "detectedAt": "2026-11-02T00:02:10Z"
      }
    ]
  },
  "error": null,
  "meta": {
    "schemaVersion": "1.0.0",
    "generatedAt": "2026-11-02T00:04:12Z",
    "dataDate": "2026-11-02",
    "count": 2
  }
}
```

**事件类型 `type`**

| 值               | 含义                                     | `fields` 内容                              |
| ---------------- | ---------------------------------------- | ------------------------------------------ |
| `price_down`     | 降价（任一价格字段下降，且没有字段上涨） | 变化的字段                                 |
| `price_up`       | 涨价（任一价格字段上涨）                 | 变化的字段                                 |
| `new_model`      | 新上线                                   | 空数组                                     |
| `removed`        | 下架（连续 3 天没抓到）                  | 空数组                                     |
| `restored`       | 下架后重新出现                           | 空数组                                     |
| `context_change` | 上下文长度变化                           | `[{field:"contextWindow", old, new, pct}]` |

> 同一个事件里有的字段涨、有的字段降时，归为 `price_up`（对用户来说涨价更需要注意），`fields` 列出全部变化。

**fields 元素**

| 字段    | 类型                                                                  | 说明                                                    |
| ------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| `field` | `input` \| `output` \| `cacheRead` \| `cacheWrite` \| `contextWindow` | 变化的字段                                              |
| `old`   | number \| null                                                        | 旧值（原币种）                                          |
| `new`   | number \| null                                                        | 新值                                                    |
| `pct`   | number \| null                                                        | 相对变化，`(new-old)/old`；旧值为 0 或 null 时为 `null` |

---

### 2.5 `GET /api/v1/changes/{YYYY-MM}.json` — 按月变动

结构与 2.4 相同，内容为该月全部事件。用于查询 90 天以前的历史。

```bash
curl -s https://alice.github.io/ai-api-price/api/v1/changes/2026-11.json
```

另提供索引文件 `GET /api/v1/changes/index.json`：

```json
{
  "success": true,
  "data": { "months": ["2026-10", "2026-11"] },
  "error": null,
  "meta": { "...": "..." }
}
```

---

### 2.6 `GET /api/v1/fx.json` — 汇率

```json
{
  "success": true,
  "data": {
    "latest": { "date": "2026-10-18", "usdCny": 7.1, "provider": "frankfurter" },
    "history": [
      { "date": "2026-10-17", "usdCny": 7.11, "provider": "frankfurter" },
      { "date": "2026-10-18", "usdCny": 7.1, "provider": "frankfurter" }
    ]
  },
  "error": null,
  "meta": {
    "schemaVersion": "1.0.0",
    "generatedAt": "2026-10-19T00:04:12Z",
    "dataDate": "2026-10-19",
    "count": 90
  }
}
```

| `provider` 取值 | 含义                                   |
| --------------- | -------------------------------------- |
| `frankfurter`   | 主源成功                               |
| `er-api`        | 主源失败，用了备源                     |
| `previous`      | 两个源都失败，沿用上次汇率             |
| `fallback`      | 连续 7 天失败，使用 `FX_FALLBACK_RATE` |

---

### 2.7 `GET /api/v1/status.json` — 数据源健康状态

供"关于"页面和外部监控使用。

```json
{
  "success": true,
  "data": {
    "run": {
      "id": "12345678901",
      "startedAt": "2026-10-19T00:00:41Z",
      "finishedAt": "2026-10-19T00:03:58Z",
      "durationMs": 197000,
      "result": "partial"
    },
    "sources": [
      {
        "id": "deepseek",
        "kind": "html",
        "status": "ok",
        "offeringCount": 4,
        "durationMs": 1830,
        "errorCode": null,
        "errorMessage": null,
        "lastSuccessAt": "2026-10-19T00:01:33Z",
        "consecutiveFailures": 0
      },
      {
        "id": "volcengine",
        "kind": "browser",
        "status": "failed",
        "offeringCount": 0,
        "durationMs": 60000,
        "errorCode": "E1002",
        "errorMessage": "请求超时（60000ms）",
        "lastSuccessAt": "2026-10-18T00:02:05Z",
        "consecutiveFailures": 1
      }
    ],
    "quarantine": [
      {
        "offeringId": "official:alibaba/qwen-max",
        "fields": [{ "field": "input", "old": 20.0, "new": 8.0, "pct": -0.6 }],
        "candidate": { "input": 8.0, "output": 60.0, "cacheRead": null, "cacheWrite": null },
        "firstSeenAt": "2026-10-19T00:02:00Z",
        "lastSeenAt": "2026-10-19T00:02:00Z",
        "confirmations": 1
      }
    ],
    "warnings": [
      {
        "code": "W3007",
        "sourceId": null,
        "offeringId": "official:mistral/mistral-large",
        "message": "官方价与 OpenRouter 价差 34%"
      }
    ]
  },
  "error": null,
  "meta": {
    "schemaVersion": "1.0.0",
    "generatedAt": "2026-10-19T00:04:12Z",
    "dataDate": "2026-10-19"
  }
}
```

| `sources[].status` | 含义                                          |
| ------------------ | --------------------------------------------- |
| `ok`               | 成功                                          |
| `failed`           | 抓取或解析失败，沿用旧数据                    |
| `rejected`         | 抓到了，但触发 V5（模型数骤降），整个源被拒绝 |

`sources[].mediaOfferingCount`（1.1 新增，可选）：该源本次产出的视频/图像报价条数，只有提供视频/图像的源（目前是 `litellm`）才有。视频/图像的 V5 单独判断，触发时 `status` 仍为 `ok`，只在 `warnings` 里记 `E3004`。

`quarantine[]`：`confirmations` 达到 2 时自动放行（DEV §5.2）；`fields` 是候选值与当前已发布值的差异。

| `run.result` | 含义                                                     |
| ------------ | -------------------------------------------------------- |
| `success`    | 全部源成功                                               |
| `partial`    | 部分源失败                                               |
| `failed`     | 全部失败（这种情况下不会发布，所以线上一般看不到这个值） |

---

### 2.8 `GET /rss.xml` · `GET /en/rss.xml` — RSS 订阅

- 格式：RSS 2.0
- 内容：最近 100 条变动事件（不包括 `context_change`）
- 每条 `<item>` 对应一个 ChangeEvent

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AI API 价格榜 · 价格变动</title>
    <link>https://alice.github.io/ai-api-price/</link>
    <description>每日自动更新的 AI 模型 API 价格变动</description>
    <language>zh-cn</language>
    <lastBuildDate>Sun, 02 Nov 2026 00:04:12 GMT</lastBuildDate>
    <item>
      <title>🔻 DeepSeek-V3（官方）输出价 ¥16 → ¥8（-50%）</title>
      <link>https://alice.github.io/ai-api-price/models/deepseek/deepseek-chat</link>
      <guid isPermaLink="false">2026-11-02-official:deepseek/deepseek-chat-1</guid>
      <pubDate>Sun, 02 Nov 2026 00:02:10 GMT</pubDate>
      <category>price_down</category>
      <description>每百万 token：输出 ¥16.00 → ¥8.00</description>
    </item>
  </channel>
</rss>
```

标题模板：

| type         | 中文                                                          | 英文                                                   |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------ |
| `price_down` | `🔻 {name}（{platform}）{字段}价 {old} → {new}（{pct}）`      | `🔻 {name} ({platform}) {field} {old} → {new} ({pct})` |
| `price_up`   | `🔺 ...`                                                      | `🔺 ...`                                               |
| `new_model`  | `🆕 新模型：{name}（{platform}）输入 {input} / 输出 {output}` | `🆕 New: {name} ...`                                   |
| `removed`    | `⛔ 已下架：{name}（{platform}）`                             | `⛔ Removed: ...`                                      |
| `restored`   | `♻️ 重新上架：{name}（{platform}）`                           | `♻️ Restored: ...`                                     |

### 2.9 `GET /api/v1/media.json` — 视频/图像生成报价（1.1 新增）

视频按**每秒生成时长**、图像按**每张**计价，与 `latest.json`（每百万 tokens）完全分开，不含 `removed`。数据来自 `data/media/latest.json`（DEV §3.13）。

报价来自两个平台：`official`（LiteLLM 收录的厂商直连价，视频和图像）和 `openrouter`（OpenRouter 的视频接口，只有视频）。同一模型在两个平台都有报价时 `modelSlug` 相同、`id` 不同（如 `official:minimax/minimax-h3-max` 和 `openrouter:minimax/minimax-h3-max`）。OpenRouter 的价格已从美分换算成美元/秒；Seedance 按 token 计价，按 16:9 标准尺寸、24fps 换算成每秒价格（见 `notes`）。

```json
{
  "success": true,
  "data": {
    "offerings": [
      {
        "id": "official:minimax/minimax-h3",
        "vendor": "minimax",
        "model": "minimax-h3",
        "modelSlug": "minimax/minimax-h3",
        "displayName": "MiniMax-H3",
        "platform": "official",
        "source": "litellm",
        "currency": "USD",
        "kind": "video",
        "unit": "per_second",
        "input": 0.04,
        "output": 0.08,
        "tiers": [
          { "label": "768p", "output": 0.08 },
          { "label": "2k", "output": 0.13 }
        ],
        "converted": {
          "usd": {
            "input": 0.04,
            "output": 0.08,
            "tiers": [
              { "label": "768p", "output": 0.08 },
              { "label": "2k", "output": 0.13 }
            ]
          },
          "cny": {
            "input": 0.267448,
            "output": 0.534896,
            "tiers": [
              { "label": "768p", "output": 0.534896 },
              { "label": "2k", "output": 0.869206 }
            ]
          }
        },
        "isFree": false,
        "stale": false,
        "status": "active",
        "change7d": null,
        "sourceUrl": "https://platform.minimax.io/docs/guides/pricing-paygo",
        "notes": null,
        "fetchedAt": "2026-10-18T13:50:46Z",
        "publishedAt": "2026-10-18T13:50:46Z"
      }
    ]
  },
  "error": null,
  "meta": {
    "schemaVersion": "1.1.0",
    "generatedAt": "2026-10-18T13:50:46Z",
    "dataDate": "2026-10-18",
    "count": 66,
    "fxRate": { "usdCny": 6.6862, "date": "2026-10-16", "provider": "frankfurter" }
  }
}
```

| 字段        | 类型                          | 说明                                                                                                                                                                                                                                                             |
| ----------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`      | `"video" \| "image"`          | 视频生成 / 图像生成                                                                                                                                                                                                                                              |
| `unit`      | `"per_second" \| "per_image"` | `output` 和 `tiers[].output` 的计价单位                                                                                                                                                                                                                          |
| `output`    | number \| null                | 每秒（或每张）生成价，原币种。来源有默认档时为默认档，否则为最低档                                                                                                                                                                                               |
| `input`     | number \| null                | 每张输入参考图的价格（图生视频、图像编辑），**总是按张**                                                                                                                                                                                                         |
| `tiers`     | array \| null                 | 分档价，按 `output` 升序。视频的 `label` 是分辨率（`480p`、`720p`、`1080p`、`2k`、`4k`），OpenRouter 报价可能带前缀：`有声` / `无声`、`文生` / `图生`、`参考`（参考视频模式）、`续写`，如 `有声 4k`、`图生 1080p`；图像是尺寸或「质量 尺寸」（`high 1024x1536`） |
| `notes`     | string \| null                | 补充说明；OpenRouter 有每次最低收费时为「每次生成最低 X USD」；Seedance 等按 token 计价的模型为换算前提（16:9 标准尺寸、24fps，其他画幅按像素数增减）                                                                                                            |
| `converted` | object                        | 换算后的 `input` / `output` / `tiers`，规则同 §2.1                                                                                                                                                                                                               |
| `change7d`  | number \| null                | 生成价与 7 天前相比的相对变化；7 天前没有记录时为 null                                                                                                                                                                                                           |
| `isFree`    | boolean                       | `output = 0`                                                                                                                                                                                                                                                     |

其余字段含义同 §2.1。ID 与 `latest.json` 是两个独立的命名空间，同一个 ID 不会同时表示文本和视频/图像报价。

---

### 2.10 `GET /api/v1/media/changes.json` — 视频/图像最近变动（1.1 新增）

结构与 §2.4 相同，只包含视频/图像报价的事件（最近 90 天）。`fields[].field` 只会是 `input`（输入参考图）或 `output`（生成价），价格单位见 `media.json` 里对应报价的 `unit`。原始按月数据在仓库的 `data/media/changes/<YYYY-MM>.json`。

---

## 3. 内部接口

### 3.1 Source 抓取器契约

完整类型定义在 `DEV_DOCUMENT.md §3.1`，这里说明**新增一个数据源**的步骤：

1. 新建 `packages/pipeline/src/sources/<id>.ts`，导出一个 `Source` 对象
2. 在 `sources/registry.ts` 中注册
3. 在 `config/providers.yaml` 中补充厂商信息和 `sourceUrl` 域名白名单
4. 运行 `pnpm pipeline snapshot <id>`，保存页面快照到 `tests/fixtures/<id>/`
5. 编写 `tests/sources/<id>.test.ts`：断言模型数量、抽样 3 个模型的价格
6. 运行 `pnpm pipeline run --only <id> --dry-run`，用真实请求验证

最小示例：

```ts
import type { Source } from "./types";
import { PipelineError } from "../core/errors";

export const exampleSource: Source = {
  id: "example",
  platform: "official",
  kind: "api",
  timeoutMs: 10_000,
  async fetch({ http }) {
    const res = await http.getJson<ExampleResponse>("https://example.com/pricing.json");
    if (!Array.isArray(res.models)) {
      throw new PipelineError("E2001", "example: models 字段缺失");
    }
    return res.models.map((m) => ({
      vendorHint: "Example",
      modelName: m.name,
      currency: "USD",
      unit: "per_1m",
      input: m.price_in ?? null,
      output: m.price_out ?? null,
      sourceUrl: "https://example.com/pricing",
    }));
  },
};
```

**视频/图像报价（1.1）**：抓取器可以在同一个数组里返回带 `media` 字段的 `RawMediaOffering`（schema 见 `shared/src/schema.ts`），管线按 `media` 字段分流，写到 `data/media/`：

```ts
{
  vendorHint: "minimax",
  modelName: "MiniMax-H3",
  currency: "USD",
  media: { kind: "video", unit: "per_second" },
  input: 0.04,   // 每张输入参考图
  output: 0.08,  // 每秒生成价（默认档），不做单位换算
  tiers: [{ label: "768p", output: 0.08 }, { label: "2k", output: 0.13 }],
  sourceUrl: "https://platform.minimax.io/docs/guides/pricing-paygo",
}
```

**抓取器约束**

| 约束                                       | 说明                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| 只返回原始数据                             | 不在抓取器里做单位换算、汇率换算、slug 规范化，这些统一交给 normalize        |
| 失败要抛错                                 | 抛 `PipelineError(code, message)`，不要返回空数组冒充成功（空数组会触发 V5） |
| 不写文件                                   | 抓取器没有副作用                                                             |
| 只通过 `ctx.http` / `ctx.browser` 访问网络 | 这样限速、重试、UA 和超时才能统一生效                                        |

### 3.2 Notifier 推送契约

```ts
// packages/pipeline/src/notify/types.ts
export interface Notifier {
  readonly id: "feishu" | "telegram" | "email";
  /** 根据环境变量判断是否已配置 */
  isConfigured(env: Env): boolean;
  /** 发送日报；失败时抛 PipelineError("E5001") */
  send(report: DailyReport): Promise<void>;
}

export interface DailyReport {
  date: string; // YYYY-MM-DD（北京时间）
  run: RunSummary; // 同 status.json 的 run
  sources: SourceResult[];
  changes: ChangeEvent[]; // 本次新增的变动
  mediaChanges?: ChangeEvent[]; // 本次新增的视频/图像变动（1.1）
  mediaUnits?: Record<string, "per_second" | "per_image">; // offeringId → 计价单位
  quarantined: QuarantineEntry[]; // 本次新进入隔离区的条目（含视频/图像）
  errors: { code: string; sourceId?: string; message: string }[];
  siteUrl: string;
}
```

飞书 Webhook 请求格式（开启签名校验时）：

```http
POST {FEISHU_WEBHOOK_URL}
Content-Type: application/json

{
  "timestamp": "1760832252",
  "sign": "<base64(hmac_sha256(key = timestamp + \"\\n\" + secret, msg = \"\"))>",
  "msg_type": "interactive",
  "card": { "...": "卡片内容，见 DEV_DOCUMENT §3.9 模板" }
}
```

飞书返回 `{"code":0}` 表示成功，其他 code 视为失败（`E5001`）。

### 3.3 命令行（CLI）

所有命令都在仓库根目录执行。

| 命令                                      | 说明                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| `pnpm pipeline run`                       | 完整运行一次管线（抓取 → 校验 → 写 data/ → 推送）         |
| `pnpm pipeline run --dry-run`             | 真实抓取，只打印结果，不写文件、不推送                    |
| `pnpm pipeline run --only deepseek,zhipu` | 只运行指定的源（其他源沿用旧数据）                        |
| `pnpm pipeline run --no-notify`           | 运行，但不推送                                            |
| `pnpm pipeline snapshot <sourceId>`       | 抓取页面原文，保存到 `tests/fixtures/<sourceId>/<日期>.*` |
| `pnpm pipeline notify:test`               | 给所有已配置的渠道发一条测试消息                          |
| `pnpm pipeline validate`                  | 用 schema 校验 `data/` 下的全部文件                       |
| `pnpm pipeline quarantine:list`           | 列出隔离区条目                                            |
| `pnpm --filter site dev`                  | 本地启动网站，默认 http://localhost:4321                  |
| `pnpm --filter site build`                | 构建静态网站到 `packages/site/dist/`                      |
| `pnpm test`                               | 运行全部单元/集成测试                                     |
| `pnpm test:e2e`                           | 运行 E2E 测试                                             |
| `pnpm lint` / `pnpm typecheck`            | 代码检查 / 类型检查                                       |

退出码见 `DEV_DOCUMENT.md §9.1`。

### 3.4 配置文件格式

**`config/providers.yaml`**

```yaml
vendors:
  - id: deepseek
    nameZh: DeepSeek
    nameEn: DeepSeek
    region: cn
    website: https://www.deepseek.com
    logo: /logos/deepseek.svg
    matchers: ["deepseek", "深度求索"] # vendorHint 匹配（不区分大小写）
    allowedSourceDomains: ["api-docs.deepseek.com"]
platforms:
  - id: openrouter
    nameZh: OpenRouter
    nameEn: OpenRouter
    website: https://openrouter.ai
    allowedSourceDomains: ["openrouter.ai"]
```

**`config/manual/<source>.yaml`**（手动兜底价格）

```yaml
source: manual-volcengine
platform: official
vendor: bytedance
currency: CNY
unit: per_1m
sourceUrl: https://www.volcengine.com/docs/...
verifiedAt: 2026-10-18 # 人工核对日期；超过 14 天未更新会在 status.json 中给出警告
models:
  - model: doubao-pro-32k
    input: 0.8
    output: 2.0
    contextWindow: 32000
```

**`config/overrides.yaml`**：见 `DEV_DOCUMENT.md §3.5`。

---

## 4. 错误码

公开接口本身不会返回错误码：文件要么存在，要么返回 404。错误码出现在以下位置：

- `status.json` 的 `sources[].errorCode` 和 `warnings[].code`
- 管线日志、GitHub Actions job summary
- 推送消息

完整对照表与处理建议见 **`DEV_DOCUMENT.md §9`**。常见几个：

| 码      | 一句话解释                 |
| ------- | -------------------------- |
| `E1001` | 请求官网失败               |
| `E1002` | 请求超时                   |
| `E1003` | 疑似被反爬拦截             |
| `E2001` | 页面改版，找不到价格表     |
| `W3003` | 价格突变，已暂扣，等待确认 |
| `E3004` | 模型数骤降，整个源被拒绝   |
| `E5001` | 推送失败                   |

---

## 5. 变更记录

| 版本  | 日期       | 变更                                                                                                                                                                                                                  |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0 | 2026-10-18 | 初版规划                                                                                                                                                                                                              |
| 1.1.0 | 2026-10-18 | 新增视频/图像生成报价：`/api/v1/media.json`、`/api/v1/media/changes.json`、`data/media/`；providers.json 增加 `mediaModelCount`；status.json 的 `sources[]` 增加可选的 `mediaOfferingCount`。原有接口的字段和含义不变 |
