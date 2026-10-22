# AI API Price Board

[中文](README.md) | **English**

A daily-updated price board for mainstream AI model APIs. Prices are scraped automatically every day and published as a free, bilingual (Chinese/English) comparison site.

- **Coverage**: official prices from 19 vendors (OpenAI, Anthropic, Google, xAI, Mistral, DeepSeek, Alibaba Qwen, Zhipu GLM, Moonshot Kimi, ByteDance Doubao…), plus aggregators (OpenRouter, SiliconFlow), cloud platforms (Azure, Bedrock, Vertex…) and inference providers (Together, Fireworks, DeepInfra, Groq…): 30 platforms and over 2,000 offers
- **Features**: price comparison table (sort, filter, search), model detail pages with price history, cost calculator, video/image generation prices (per second / per image), change log, RSS feed, open JSON API, USD/CNY toggle, dark mode
- **Runs on**: GitHub Actions updates the data every day at around 07:17 Beijing time (23:17 UTC); GitHub Pages hosts the site for free, so no server is needed
- **Alerts**: price changes and scraping failures are pushed to a Feishu (Lark) group

| Document                                         | Contents                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| [DEV_DOCUMENT.md](DEV_DOCUMENT.md)               | Architecture, data model, validation rules, error codes, dev log (Chinese) |
| [AI_API_价格榜_API.md](AI_API_价格榜_API.md)     | Open JSON API, RSS, CLI, config file formats (Chinese)                     |
| [AI_API_价格榜_STYLE.md](AI_API_价格榜_STYLE.md) | Code conventions, colors, components, copy guidelines (Chinese)            |

---

## 🚀 Step-by-step deployment

Copy and paste as you go. It takes about 10 minutes.

### Step 1: Prerequisites

You need a GitHub account and the following installed locally:

- Node.js 24 or later: `node -v`
- pnpm 9: `npm install -g pnpm@9`
- GitHub CLI: `brew install gh`, then sign in with `gh auth login`

### Step 2: Create a Feishu group bot

1. Open the Feishu group that should receive alerts, then go to **Settings → Group bots → Add bot → Custom bot**. This must be done in the Feishu desktop or mobile app; the web version has no "Add bot" option
2. Give it any name (for example "Price Board") and copy the generated **Webhook URL**
3. Under "Security settings", enable **Signature verification** and copy the **secret**. Do not enable the IP allowlist: GitHub Actions runners use changing IP addresses
4. Click Done

### Step 3: Test notifications locally

From the project root:

```bash
cp .env.example .env
```

Open `.env` in an editor and fill in the two values from Step 2:

```
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx
FEISHU_WEBHOOK_SECRET=the-secret-from-step-2
```

Then send a test message:

```bash
pnpm install
```

```bash
pnpm pipeline notify:test
```

✅ If a test message arrives in the Feishu group, notifications are configured correctly.

### Step 4: Create a GitHub repository and push

Replace `ai-api-price` with the repository name you want:

```bash
gh repo create ai-api-price --public --source=. --push
```

> The repository must be **public**: GitHub Pages on the free plan only works with public repositories, and Actions minutes are free for public repositories.

### Step 5: Enable Pages and write permission on GitHub

Open `https://github.com/<your-username>/ai-api-price/settings`:

1. Left sidebar **Pages** → Build and deployment → Source: choose **GitHub Actions**
2. Left sidebar **Actions → General** → Workflow permissions at the bottom: choose **Read and write permissions** → Save

### Step 6: Add the Feishu secrets to GitHub

```bash
gh secret set FEISHU_WEBHOOK_URL --repo <your-username>/ai-api-price
```

```bash
gh secret set FEISHU_WEBHOOK_SECRET --repo <your-username>/ai-api-price
```

Each command prompts for the value: paste it and press Enter (the input may not be shown on screen). Confirm with:

```bash
gh secret list --repo <your-username>/ai-api-price
```

(Optional) To verify the whole chain on the first run, make it send an "all good" message even when no prices changed:

```bash
gh variable set NOTIFY_ON_SUCCESS --body true
```

Remove the variable once you have confirmed it works: `gh variable delete NOTIFY_ON_SUCCESS`.

### Step 7: Run it for the first time

```bash
gh workflow run daily
```

```bash
gh run watch
```

### ✅ How to tell it worked

1. `gh run watch` shows both the `update` and `deploy` jobs with a green ✓
2. `https://<your-username>.github.io/ai-api-price/` shows the price board, along with when the data was last updated
3. The Feishu group receives the "AI API 价格日报" (daily price report). This only happens when prices changed, or if you set `NOTIFY_ON_SUCCESS` in Step 6

From then on the site updates itself every day at around 07:17 Beijing time with no action needed. GitHub queues scheduled runs, so the time deliberately avoids the top of the hour (runs scheduled at 00:00 UTC were delayed by about 3 hours).

### Using your own domain later

1. Repository Settings → Pages → Custom domain: enter your domain
2. Add a DNS CNAME record pointing to `<your-username>.github.io`
3. Set the variables:

```bash
gh variable set SITE_URL --body https://your-domain
```

```bash
gh variable set BASE_PATH --body /
```

---

## 📘 User guide

### Features

| Feature            | In one sentence                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Price board (home) | One row per model with the lowest price, which platform offers it, and how many platforms carry the model. Click "N platforms" to see official, aggregator, cloud (Azure, Bedrock…) and inference-provider (Together, DeepInfra…) prices side by side. Switch to "All offers" to list every offer |
| Today's changes    | Cards at the top of the home page listing price drops, price increases and new models in the last 24 hours                                                                                                                                                                                        |
| Filter and search  | Filter by vendor, model, international/China, platform and context length; show free models only; or search by name                                                                                                                                                                               |
| Currency toggle    | ¥ CNY / $ USD in the top-right corner; prices marked ≈ are converted at the day's exchange rate                                                                                                                                                                                                   |
| Model details      | Click any row to compare the model across platforms and see tiered pricing and price history                                                                                                                                                                                                      |
| Cost calculator    | Enter input/output tokens per request and requests per day to get each model's monthly cost                                                                                                                                                                                                       |
| Video & image      | Switch the price board to the "Video" or "Image" tab: video models are priced per second and image models per image, with resolution tiers                                                                                                                                                        |
| Coding plans       | The "Coding plans" tab: monthly price and limits of Claude, ChatGPT/Codex, GitHub Copilot, Cursor, Kimi, Zhipu, Volcano Ark, MiniMax, Alibaba Bailian and more, plus how many requests a month it takes for a plan to beat pay-as-you-go                                                          |
| Change log         | Every price increase, price drop, new model and removal, grouped by date                                                                                                                                                                                                                          |
| RSS feed           | The RSS link in the footer lets any feed reader follow price changes                                                                                                                                                                                                                              |
| About              | Data sources, the health of each source, and suspicious prices awaiting confirmation                                                                                                                                                                                                              |

### How to use it

1. **Find the cheapest model**: the home page table is already sorted cheapest first. To see only Chinese vendors, click "China"
2. **Estimate your monthly bill**: click "Calculator" at the top → enter input tokens per request (for example `2k`), output tokens and requests per day → the monthly cost ranking appears below
3. **See a model's price history**: click the model name in the table → "Price history" on the detail page
4. **Compare one model across platforms**: open the "Model" filter, type part of the name, and tick it. The URL updates, so you can share the filtered view
5. **Switch language or dark mode**: use the buttons in the top-right corner; your choice is remembered

### FAQ

- **What is the "blended price"?** Blended price = (3 × input price + 1 × output price) ÷ 4. Most applications send roughly three times as many input tokens as output tokens, so sorting by this tracks real-world cost more closely.
- **Why are free models listed last?** Free models are mostly limited-time or experimental versions, so the default sort puts them after paid models. Tick "Free only" to see them on their own.
- **Why are Alibaba, Kimi and SiliconFlow shown in USD?** Alibaba's "Official" rows are the **Beijing region** prices published on Alibaba Cloud's international site (listed in USD). Kimi's "Official" and the "SiliconFlow" rows are international-site prices. Rows labelled "Official (China)" and "SiliconFlow (China)" come from [models.dev](https://models.dev) community data: original CNY prices converted to USD. Always check the vendor's own site.
- **What does ⚠ next to a price mean?** The latest scrape of that source failed, so the price shown is from the last successful scrape.
- **Are the prices accurate?** Every price links to its source and passes automatic checks; any price that moves more than 80% in a day is held back until it is confirmed. Prices are still for reference only. **The vendor's official site always wins.**

### Reporting problems

Open an issue in the GitHub repository. Please include the model name and a link to the official price you saw.

---

## 🛠 Developer guide

### Requirements

| Software            | Version                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| Node.js             | ≥ 24 (`.nvmrc` says 24; tested on 25.6.1)                                         |
| pnpm                | 9.15.9 (`package.json#packageManager`)                                            |
| Playwright Chromium | Install once with `pnpm --filter @aipb/pipeline exec playwright install chromium` |

### Install and run locally

```bash
pnpm install
```

```bash
pnpm --filter @aipb/pipeline exec playwright install chromium
```

Scrape once for real, printing results without writing files:

```bash
pnpm pipeline run --dry-run
```

Scrape and write to `data/`, without sending notifications:

```bash
pnpm pipeline run --no-notify
```

Start the site dev server (http://localhost:4321):

```bash
pnpm dev
```

### Common commands

| Command                                                    | What it does                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm pipeline run [--dry-run] [--only a,b] [--no-notify]` | Run the pipeline                                            |
| `pnpm pipeline snapshot <sourceId>`                        | Save a source's page snapshot to `tests/fixtures/`          |
| `pnpm pipeline notify:test`                                | Send a test message to every configured channel             |
| `pnpm pipeline validate`                                   | Validate every file under `data/` against the schema        |
| `pnpm pipeline quarantine:list`                            | List quarantined prices (suspicious, awaiting confirmation) |
| `pnpm build`                                               | Build the site into `packages/site/dist/`                   |
| `pnpm test` / `pnpm test:coverage`                         | Unit and integration tests                                  |
| `pnpm test:e2e`                                            | Site end-to-end tests (using fixture data)                  |
| `pnpm lint` / `pnpm typecheck`                             | Lint / type check                                           |

### Environment variables

See [DEV_DOCUMENT.md §7](DEV_DOCUMENT.md#7-环境变量) for the full list and `.env.example` for a template. The most common ones:

| Variable                                       | Required                      | Purpose                                                 |
| ---------------------------------------------- | ----------------------------- | ------------------------------------------------------- |
| `FEISHU_WEBHOOK_URL` / `FEISHU_WEBHOOK_SECRET` | Recommended                   | Feishu group bot                                        |
| `SITE_URL` / `BASE_PATH`                       | Inferred automatically online | Only set these for a custom domain                      |
| `NOTIFY_ON_SUCCESS`                            | No                            | Notify even when nothing changed                        |
| `ANOMALY_THRESHOLD`                            | No                            | Threshold for holding back sudden changes, default 0.8  |
| `SOURCES_ENABLED`                              | No                            | Run only some sources                                   |
| `ANALYTICS_PROVIDER` / `ANALYTICS_TOKEN`       | No                            | Visitor analytics, see "Enable visitor analytics" below |

### Enable visitor analytics (optional)

The site supports two cookie-free analytics services; both are off by default. Using Cloudflare Web Analytics (free) as an example:

1. In the Cloudflare dashboard → **Web Analytics** → **Add a site**, enter your site's address (for example `mypicko.github.io`)
2. In the JS snippet it shows, copy the 32-character value from `"token": "…"`
3. Set two variables (the analytics token appears in public pages, so it is not a secret; use a variable, not a secret):

```bash
gh variable set ANALYTICS_PROVIDER --body cloudflare
```

```bash
gh variable set ANALYTICS_TOKEN --body your-token
```

4. It takes effect after the next daily run, or right away with `gh workflow run daily`

For Umami, set `ANALYTICS_PROVIDER` to `umami` and `ANALYTICS_TOKEN` to the website ID; for a self-hosted Umami, also set `ANALYTICS_SCRIPT_URL`.

### Common errors

| Symptom                                      | Cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feishu reports `E1003`                       | A vendor site blocked the request. Don't try to get around anti-bot measures; maintain that vendor's prices by hand in `config/manual/<id>.yaml` instead                                                                                                                                                                                                                                                                                                      |
| Feishu reports `E2001` / `E3004`             | The vendor redesigned its page. Run `pnpm pipeline snapshot <id>` to save the new page, update `packages/pipeline/src/sources/<id>.ts`, and update the tests                                                                                                                                                                                                                                                                                                  |
| Feishu reports `W3003`                       | A price moved more than 80% in one day and is being held back (a scraped web page, or an API source whose re-check returned a different value). Check the vendor's site: if it's real, it publishes automatically the next day; to release it now, add an `approve` entry to `config/overrides.yaml`. Sudden changes from API sources such as OpenRouter and LiteLLM are re-requested in the same run and published right away if both values match (`W3008`) |
| `E1005`                                      | A source has failed 3 days in a row and needs attention                                                                                                                                                                                                                                                                                                                                                                                                       |
| Actions fails with `Permission denied` / 403 | "Read and write permissions" from Step 5 is not enabled                                                                                                                                                                                                                                                                                                                                                                                                       |
| Deployed site has no styling                 | `BASE_PATH` is wrong. When using `xxx.github.io/<repo>/`, don't set `BASE_PATH` yourself                                                                                                                                                                                                                                                                                                                                                                      |
| All error codes                              | See [DEV_DOCUMENT.md §9](DEV_DOCUMENT.md#9-错误码对照表)                                                                                                                                                                                                                                                                                                                                                                                                      |

### Extending the project

- **Add a data source**: follow the 6 steps in [API doc §3.1](AI_API_价格榜_API.md#31-source-抓取器契约)
- **Maintain a vendor's prices by hand**: add a YAML file under `config/manual/`; the format is in [API doc §3.4](AI_API_价格榜_API.md#34-配置文件格式)
- **Merge different spellings of the same model**: edit `config/aliases.yaml`
- **Data structures**: the single source of truth is `packages/shared/src/schema.ts`
- **Layout**: `packages/shared` (contracts), `packages/pipeline` (scraping pipeline), `packages/site` (website), `config/` (configuration), `data/` (generated automatically; do not edit by hand)

### Known limitations

- Alibaba is scraped from the Beijing region prices on Alibaba Cloud's international site (listed in USD). Kimi and SiliconFlow are scraped from their international sites, so those prices are in USD. China-site prices for Kimi, MiniMax, StepFun and SiliconFlow are filled in from [models.dev](https://models.dev) community data (shown as "Official (China)" and "SiliconFlow (China)", converted from CNY to USD). Baidu Qianfan has no data yet. The reason is that GitHub Actions runs outside mainland China and cannot reach these China sites. If you need CNY prices from the China sites, run the pipeline on a machine in mainland China or maintain them by hand in `config/manual/`
- `github.io` can be slow to load from mainland China; consider also deploying to Cloudflare Pages
- See [DEV_DOCUMENT.md §14](DEV_DOCUMENT.md#14-问题汇总) for the full list of known issues
