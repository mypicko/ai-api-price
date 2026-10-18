# AI API 价格榜

每天自动抓取全球主流 AI 模型 API 的最新价格，发布成一个免费托管、中英双语的比价网站。

- **覆盖**：OpenAI、Anthropic、Google、xAI、Mistral、DeepSeek、阿里通义、智谱、Kimi、豆包等 17 家厂商，加上 OpenRouter 和硅基流动两个聚合平台。首次运行共 779 条报价
- **功能**：价格对比表（排序、筛选、搜索）、模型详情和价格走势、成本计算器、视频/图像生成模型价格（按秒 / 按张）、变动日志、RSS 订阅、开放 JSON 接口、美元/人民币切换、暗色模式
- **运行**：GitHub Actions 每天北京时间 08:00 自动更新，GitHub Pages 免费托管，不需要服务器
- **提醒**：价格有变动或抓取失败时，推送到飞书群

| 文档                                             | 内容                                           |
| ------------------------------------------------ | ---------------------------------------------- |
| [DEV_DOCUMENT.md](DEV_DOCUMENT.md)               | 架构、数据模型、校验规则、错误码、开发节点记录 |
| [AI_API_价格榜_API.md](AI_API_价格榜_API.md)     | 开放 JSON 接口、RSS、CLI、配置文件格式         |
| [AI_API_价格榜_STYLE.md](AI_API_价格榜_STYLE.md) | 代码规范、色彩、组件、文案规范                 |

---

## 🚀 手把手部署教程

照着复制粘贴即可，大约 10 分钟。

### 第一步：准备

需要一个 GitHub 账号，以及本机已安装：

- Node.js 24 或更高版本：`node -v`
- pnpm 9：`npm install -g pnpm@9`
- GitHub CLI：`brew install gh`，然后执行 `gh auth login` 登录

### 第二步：创建飞书群机器人

1. 打开要接收通知的飞书群，依次点击：**设置 → 群机器人 → 添加机器人 → 自定义机器人**
2. 名字随便填（例如「价格榜」），复制生成的 **Webhook 地址**
3. 在「安全设置」里勾选**签名校验**，复制**密钥**
4. 点击完成

### 第三步：本地测试推送

在项目根目录执行：

```bash
cp .env.example .env
```

用编辑器打开 `.env`，填入第二步拿到的两个值：

```
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx
FEISHU_WEBHOOK_SECRET=第二步复制的密钥
```

然后发送一条测试消息：

```bash
pnpm install
```

```bash
pnpm pipeline notify:test
```

✅ 飞书群里收到一条测试消息，说明推送配置正确。

### 第四步：创建 GitHub 仓库并推送代码

把 `ai-api-price` 换成你想要的仓库名：

```bash
gh repo create ai-api-price --public --source=. --push
```

> 必须是**公开仓库**：GitHub Pages 免费版只支持公开仓库，公开仓库的 Actions 也不计费。

### 第五步：在 GitHub 上开启 Pages 和写权限

打开 `https://github.com/<你的用户名>/ai-api-price/settings`：

1. 左侧 **Pages** → Build and deployment → Source 选 **GitHub Actions**
2. 左侧 **Actions → General** → 页面底部 Workflow permissions 选 **Read and write permissions** → Save

### 第六步：把飞书密钥填到 GitHub

```bash
gh secret set FEISHU_WEBHOOK_URL
```

```bash
gh secret set FEISHU_WEBHOOK_SECRET
```

每条命令执行后粘贴对应的值，按回车即可。

（可选）让第一次运行即使没有价格变动也推送一条「一切正常」，方便确认整条链路是通的：

```bash
gh variable set NOTIFY_ON_SUCCESS --body true
```

确认之后可以删掉这个变量：`gh variable delete NOTIFY_ON_SUCCESS`。

### 第七步：手动运行第一次

```bash
gh workflow run daily
```

```bash
gh run watch
```

### ✅ 部署成功的标志

1. `gh run watch` 显示 `update` 和 `deploy` 两个任务都是绿色 ✓
2. 打开 `https://<你的用户名>.github.io/ai-api-price/`，能看到价格榜，页面顶部显示「数据更新于 今天 xx:xx」
3. 飞书群收到「AI API 价格日报」（需要有变动，或者第六步设置了 `NOTIFY_ON_SUCCESS`）

之后每天北京时间 08:00 左右会自动更新，不需要任何操作。GitHub 的定时任务可能延迟 5~30 分钟。

### 以后想绑定自己的域名

1. 仓库 Settings → Pages → Custom domain，填入域名
2. 在 DNS 中添加一条 CNAME 记录，指向 `<你的用户名>.github.io`
3. 设置变量：

```bash
gh variable set SITE_URL --body https://你的域名
```

```bash
gh variable set BASE_PATH --body /
```

---

## 📘 普通用户手册

### 功能介绍

| 功能           | 一句话说明                                                                      |
| -------------- | ------------------------------------------------------------------------------- |
| 价格榜（首页） | 所有模型的输入、输出、缓存价格一张表看完，默认按「混合价」从便宜到贵排序        |
| 今日变动       | 首页顶部的卡片，列出最近 24 小时涨价、降价和新上线的模型                        |
| 筛选与搜索     | 按厂商、国际/国内、平台、上下文长度筛选，只看免费模型，或者直接搜索模型名       |
| 币种切换       | 右上角 ¥ CNY / $ USD；带 ≈ 的价格是按当天汇率换算出来的                         |
| 模型详情       | 点击任意一行，可以看这个模型在各平台的价格对比、阶梯价和价格走势                |
| 成本计算器     | 填入每次输入/输出多少 token、每天调用多少次，自动算出每个模型每月要花多少钱     |
| 视频/图像      | 视频生成模型按每秒、图像生成模型按每张列出价格和分辨率档位（顶部「视频/图像」） |
| 变动日志       | 按日期列出所有涨价、降价、上新、下架记录                                        |
| RSS 订阅       | 页脚的 RSS 链接，用任意 RSS 阅读器订阅价格变动                                  |
| 关于           | 数据来源、每个数据源的健康状态、待确认的异常价格                                |

### 使用步骤

1. **找最便宜的模型**：打开首页，表格默认就是从便宜到贵排列；只关心国内厂商的话，点「国内」
2. **估算每月花费**：点顶部「计算器」→ 填入每次输入 token（例如 `2k`）、输出 token、每天次数 → 下方列出每月成本排行
3. **看某个模型的价格历史**：在表格里点模型名 → 详情页的「价格走势」
4. **切换语言或暗色模式**：右上角的按钮，选择会自动记住

### 常见问题

- **「混合价」是什么？** 混合价 = (3 × 输入价 + 1 × 输出价) ÷ 4。大多数应用的输入量大约是输出量的 3 倍，所以用这个来排序更贴近真实花费。
- **为什么免费模型排在最后？** 免费模型大多是限时或实验版本，默认排在付费模型后面；勾选「仅免费」就能单独查看。
- **为什么阿里、Kimi、硅基流动显示的是美元价？** 目前抓取的是它们国际站的价格。国内站的人民币价格可能不同，请以官网为准。
- **价格旁边的 ⚠ 是什么意思？** 这个数据源最近一次抓取失败了，显示的是上次成功抓到的价格。
- **价格准确吗？** 每条价格都附有官网链接，并且经过自动校验；单日变动超过 80% 的价格会先暂扣，确认后才发布。但价格仍然只供参考，**以各厂商官网为准**。

### 反馈问题

在 GitHub 仓库的 Issues 页面提交问题，请附上模型名和你看到的官网价格链接。

---

## 🛠 技术人员手册

### 环境要求

| 软件                | 版本                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| Node.js             | ≥ 24（`.nvmrc` 写的是 24；本项目在 25.6.1 上测试通过）                   |
| pnpm                | 9.15.9（`package.json#packageManager`）                                  |
| Playwright Chromium | 首次执行 `pnpm --filter @aipb/pipeline exec playwright install chromium` |

### 安装与本地启动

```bash
pnpm install
```

```bash
pnpm --filter @aipb/pipeline exec playwright install chromium
```

真实抓取一次（只打印结果，不写文件）：

```bash
pnpm pipeline run --dry-run
```

抓取并写入 `data/`，不推送：

```bash
pnpm pipeline run --no-notify
```

启动网站开发服务器（http://localhost:4321）：

```bash
pnpm dev
```

### 常用命令

| 命令                                                       | 说明                                     |
| ---------------------------------------------------------- | ---------------------------------------- |
| `pnpm pipeline run [--dry-run] [--only a,b] [--no-notify]` | 运行管线                                 |
| `pnpm pipeline snapshot <sourceId>`                        | 保存某个源的页面快照到 `tests/fixtures/` |
| `pnpm pipeline notify:test`                                | 给已配置的渠道发测试消息                 |
| `pnpm pipeline validate`                                   | 用 schema 校验 `data/` 下的全部文件      |
| `pnpm pipeline quarantine:list`                            | 查看隔离区（疑似异常、待确认的价格）     |
| `pnpm build`                                               | 构建网站到 `packages/site/dist/`         |
| `pnpm test` / `pnpm test:coverage`                         | 单元 + 集成测试（368 个）                |
| `pnpm test:e2e`                                            | 网站 E2E 测试（使用 fixture 数据）       |
| `pnpm lint` / `pnpm typecheck`                             | 代码检查 / 类型检查                      |

### 环境变量

完整说明见 [DEV_DOCUMENT.md §7](DEV_DOCUMENT.md#7-环境变量)，模板见 `.env.example`。常用的几个：

| 变量                                           | 必填         | 说明                   |
| ---------------------------------------------- | ------------ | ---------------------- |
| `FEISHU_WEBHOOK_URL` / `FEISHU_WEBHOOK_SECRET` | 推荐         | 飞书群机器人           |
| `SITE_URL` / `BASE_PATH`                       | 线上自动推断 | 绑定自定义域名时再设置 |
| `NOTIFY_ON_SUCCESS`                            | 否           | 没有变动也推送         |
| `ANOMALY_THRESHOLD`                            | 否           | 突变拦截阈值，默认 0.8 |
| `SOURCES_ENABLED`                              | 否           | 只运行部分源           |

### 常见报错

| 现象                                 | 原因与处理                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 飞书收到 `E1003`                     | 某个官网拦截了请求。不要对抗反爬，改成在 `config/manual/<id>.yaml` 中人工维护                                                       |
| 飞书收到 `E2001` / `E3004`           | 官网改版了。执行 `pnpm pipeline snapshot <id>` 保存新页面，修改 `packages/pipeline/src/sources/<id>.ts`，更新测试                   |
| 飞书收到 `W3003`                     | 某个价格单日变动超过 80%，已暂扣。去官网核对：如果是真的，第二天会自动发布；想立即放行，在 `config/overrides.yaml` 加一条 `approve` |
| `E1005`                              | 某个源已经连续失败 3 天，必须处理                                                                                                   |
| Actions 报 `Permission denied` / 403 | 第五步的 Read and write permissions 没打开                                                                                          |
| 部署成功但页面没有样式               | `BASE_PATH` 不对；使用 `xxx.github.io/仓库名/` 时不要手动设置 `BASE_PATH`                                                           |
| 全部错误码                           | 见 [DEV_DOCUMENT.md §9](DEV_DOCUMENT.md#9-错误码对照表)                                                                             |

### 二次开发

- **新增一个数据源**：按 [API 文档 §3.1](AI_API_价格榜_API.md#31-source-抓取器契约) 的 6 个步骤操作
- **手动维护某家的价格**：在 `config/manual/` 下新建 YAML，格式见 [API 文档 §3.4](AI_API_价格榜_API.md#34-配置文件格式)
- **合并同一模型的不同写法**：编辑 `config/aliases.yaml`
- **数据结构**：唯一可信的定义在 `packages/shared/src/schema.ts`
- **目录结构**：`packages/shared`（契约）、`packages/pipeline`（抓取管线）、`packages/site`（网站）、`config/`（配置）、`data/`（自动生成，请勿手动修改）

### 已知限制

- 阿里、Kimi、硅基流动目前抓取的是国际站的美元价格；百度千帆暂时没有数据。原因是 GitHub Actions 运行在海外，访问不了这些国内站。如果需要国内人民币价格，可以在国内机器上运行管线，或者人工维护 `config/manual/`
- 国内访问 `github.io` 可能较慢，可以考虑同时部署到 Cloudflare Pages
- 详见 [DEV_DOCUMENT.md §14 问题汇总](DEV_DOCUMENT.md#14-问题汇总)
