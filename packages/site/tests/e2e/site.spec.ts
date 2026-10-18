import { expect, test, type Page } from "@playwright/test";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

/** 打开页面并等待所有 island 水合完成，避免水合前的点击/输入不生效（DEV §14 #9） */
async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

const bodyRows = (page: Page) => page.getByTestId("price-table").locator("tbody tr");

test.describe("首页", () => {
  test("加载价格榜和今日变动，没有控制台错误（含 CSP）", async ({ page }) => {
    const errors = collectErrors(page);
    await gotoHydrated(page, "/");
    await expect(page).toHaveTitle(/AI API 价格榜/);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByTestId("today-changes").locator("> ul > li")).toHaveCount(6);
    // 默认按模型聚合：27 个模型、34 条报价
    await expect(bodyRows(page)).toHaveCount(27);
    await expect(page.getByTestId("result-count")).toHaveText("共 27 个模型 · 34 个报价");
    await expect(page.locator('link[hreflang="en"]')).toHaveAttribute("href", /\/en\/$/);
    await expect(page.locator('meta[http-equiv="content-security-policy"]')).toHaveCount(1);
    // 抓来的文本按纯文本渲染（S5）
    await expect(page.getByText('Llama 3.3 70B <Instruct> & "Free"').first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("默认按混合价升序，点击表头切换升序 → 降序 → 默认", async ({ page }) => {
    await gotoHydrated(page, "/");
    const header = page.locator("th", { has: page.getByRole("button", { name: /^输出/ }) });
    await expect(header).toHaveAttribute("aria-sort", "none");
    // 默认排序中免费模型排在付费模型之后
    await expect(bodyRows(page).first()).not.toContainText("免费");
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await expect(bodyRows(page).first()).toContainText("Claude Opus 4.1");
    await expect(page).toHaveURL(/sort=output&dir=desc/);
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "none");
    await expect(page).toHaveURL(/\/$/);
  });

  test("筛选：搜索、地区、仅免费、厂商，并同步到 URL（按报价视图）", async ({ page }) => {
    await gotoHydrated(page, "/?view=offers");
    await page.getByPlaceholder(/搜索模型/).fill("deepseek v3");
    await expect(bodyRows(page)).toHaveCount(3);
    await expect(page).toHaveURL(/q=deepseek\+v3/);
    await page.getByPlaceholder(/搜索模型/).fill("");
    await page.getByRole("button", { name: "国内" }).click();
    await expect(page.getByTestId("result-count")).toHaveText("共 19 个报价");
    await page.getByLabel("仅免费").check();
    await expect(bodyRows(page)).toHaveCount(2);
    await expect(page).toHaveURL(/region=cn.*free=1/);
    await page.reload();
    await expect(bodyRows(page)).toHaveCount(2);
    await expect(page.getByLabel("仅免费")).toBeChecked();
    await page.goto("/?view=offers&vendor=openai");
    await expect(bodyRows(page)).toHaveCount(4);
    await page.getByTestId("vendor-filter").locator("summary").click();
    await page.getByTestId("vendor-filter").getByLabel("Anthropic").check();
    await expect(bodyRows(page)).toHaveCount(8);
  });

  test("按模型聚合：显示最低价和平台数，可展开各平台报价，可切到按报价", async ({ page }) => {
    const errors = collectErrors(page);
    await gotoHydrated(page, "/");
    await page.getByPlaceholder(/搜索模型/).fill("deepseek v3");
    await expect(bodyRows(page)).toHaveCount(1);
    const count = page.getByTestId("platform-count");
    await expect(count).toHaveText(/3 个平台/);
    await expect(count).toHaveAttribute("aria-expanded", "false");
    await count.click();
    await expect(count).toHaveAttribute("aria-expanded", "true");
    const nested = page.getByTestId("price-table").locator('tbody tr[data-nested="true"]');
    await expect(nested).toHaveCount(3);
    // 展开的子行按价格从低到高，第一条就是代表行的平台
    const bestPlatform = await bodyRows(page).first().locator("td").nth(1).innerText();
    await expect(nested.first()).toContainText(bestPlatform.replace(/\s*3 个平台.*$/s, "").trim());
    await count.click();
    await expect(nested).toHaveCount(0);
    // 切到按报价：3 条
    await page.getByTestId("view-toggle").getByRole("button", { name: "按报价" }).click();
    await expect(page).toHaveURL(/view=offers/);
    await expect(bodyRows(page)).toHaveCount(3);
    await expect(page.getByTestId("result-count")).toHaveText("共 3 个报价");
    // 选定平台后，每个模型显示的就是该平台的价格
    await page.getByTestId("view-toggle").getByRole("button", { name: "按模型" }).click();
    await page.getByLabel("平台", { exact: true }).selectOption({ label: "OpenRouter" });
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText("OpenRouter");
    await expect(page.getByTestId("platform-count")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("模型筛选：下拉框盖在表头之上，跟随厂商联动并同步到 URL", async ({ page }) => {
    await gotoHydrated(page, "/");
    const picker = page.getByTestId("model-filter");
    await picker.locator("summary").click();
    // 下拉列表中心点上方的元素必须属于下拉框，而不是被表格的 sticky 表头盖住
    const list = picker.locator("fieldset");
    const box = await list.boundingBox();
    expect(box).not.toBeNull();
    const onTop = await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x ?? 0, y ?? 0)?.closest("[data-testid=model-filter]") !== null,
      [(box?.x ?? 0) + 40, (box?.y ?? 0) + 20],
    );
    expect(onTop).toBe(true);
    await picker.getByPlaceholder("输入名称过滤").fill("deepseek");
    await picker.getByLabel(/DeepSeek-V3/).check();
    await expect(page).toHaveURL(/model=deepseek%2Fdeepseek-chat/);
    const count = await bodyRows(page).count();
    expect(count).toBeGreaterThan(0);
    for (const row of await bodyRows(page).all()) await expect(row).toContainText("DeepSeek-V3");
    // 点击外部关闭下拉框
    await page.locator("h1").click();
    await expect(picker).not.toHaveAttribute("open", "");
    // 换成别的厂商时，已选的 DeepSeek 模型被自动清掉
    await page.getByTestId("vendor-filter").locator("summary").click();
    await page.getByTestId("vendor-filter").getByLabel("OpenAI").check();
    await expect(page).not.toHaveURL(/model=/);
    await expect(page).toHaveURL(/vendor=openai/);
  });

  test("币种切换：价格换算，选择保存在 localStorage", async ({ page }) => {
    await page.goto("/?q=gpt-4o");
    const cell = bodyRows(page).first().locator("td").nth(2);
    await expect.poll(() => cell.innerText()).toBe("≈ ¥1.07");
    await page.getByTestId("currency-toggle").getByRole("button", { name: /USD/ }).click();
    await expect.poll(() => cell.innerText()).toBe("$0.150");
    await expect(page.locator("html")).toHaveAttribute("data-currency", "USD");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-currency", "USD");
    await expect.poll(() => cell.innerText()).toBe("$0.150");
  });

  test("语言切换：跳转到英文页并保存偏好", async ({ page }) => {
    await page.goto("/calculator/");
    await page.getByTestId("lang-toggle").click();
    await expect(page).toHaveURL(/\/en\/calculator\/$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cost calculator");
    expect(await page.evaluate(() => localStorage.getItem("aipb.lang"))).toBe("en");
    // 英文页默认 USD
    await page.goto("/en/?q=deepseek");
    await expect(page.locator("html")).toHaveAttribute("data-currency", "USD");
  });

  test("暗色模式：切换后加 html.dark，刷新不闪白", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.getByTestId("theme-toggle").getByRole("button", { name: "深色" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(11, 13, 16)");
    await page.reload({ waitUntil: "commit" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByTestId("theme-toggle").getByRole("button", { name: "浅色" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });
});

test.describe("其他页面", () => {
  test("计算器：修改用量后重新排名，支持 2k / 1m 写法", async ({ page }) => {
    await page.goto("/calculator/");
    const results = page.getByTestId("calc-results").locator("tbody tr");
    await expect(results).toHaveCount(20);
    await expect(page.getByTestId("calc-usage")).toContainText("6,000 万 tokens");
    await page.getByLabel("每次请求输入 token").fill("1m");
    await expect(page.getByTestId("calc-usage")).toContainText("300 亿 tokens");
    await page.getByLabel("每次请求输入 token").fill("abc");
    await expect(page.getByText("请输入有效的非负数字")).toBeVisible();
    await page.getByLabel("每次请求输入 token").fill("2k");
    await page.getByText("Anthropic", { exact: true }).click();
    await expect(results).toHaveCount(4);
    // Claude Sonnet 4.5：60M × $3 + 15M × $15 = $405
    await page.getByTestId("currency-toggle").getByRole("button", { name: /USD/ }).click();
    const cost = results.filter({ hasText: "Claude Sonnet 4.5" }).first().locator("td").last();
    await expect.poll(() => cost.innerText()).toBe("$405");
  });

  test("详情页：报价对比、阶梯价、走势图渲染", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/models/deepseek/deepseek-chat/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DeepSeek-V3");
    await expect(page.getByTestId("offering-compare").locator("tbody tr")).toHaveCount(3);
    await page.getByTestId("price-chart").scrollIntoViewIfNeeded();
    await expect(page.locator(".aipb-chart canvas")).toHaveCount(1);
    await expect(page.locator(".aipb-chart .u-legend .u-series")).toHaveCount(7);
    await page.getByRole("button", { name: "30 天" }).click();
    await expect(page.locator(".aipb-chart canvas")).toHaveCount(1);
    await page.goto("/models/alibaba/qwen3-max/");
    await expect(page.getByTestId("tier-table")).toHaveCount(1);
    await page.goto("/models/bytedance/doubao-seed-1.6/");
    await expect(page.getByRole("status").first()).toContainText("8 天前更新");
    await page.goto("/models/openai/gpt-5/");
    await expect(page.getByTestId("chart-unchanged")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("变动日志：按类型和厂商筛选", async ({ page }) => {
    await page.goto("/changes/");
    // ChangeLog 是 client:idle，并行跑测试时水合可能晚于第一次 selectOption
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    const items = page.getByTestId("change-log").locator("ol > li");
    const total = await items.count();
    expect(total).toBeGreaterThan(10);
    await page.getByLabel("类型").selectOption("price_down");
    await expect(items.first()).toContainText("降价");
    expect(await items.count()).toBeLessThan(total);
    await page.getByLabel("厂商").selectOption("deepseek");
    await expect(items).toHaveCount(3);
  });

  test("关于页：显示失败的数据源、连续失败次数和隔离区", async ({ page }) => {
    await page.goto("/about/");
    const failed = page.getByTestId("source-health").locator('tr[data-status="failed"]');
    await expect(failed).toContainText("volcengine");
    await expect(failed).toContainText("8");
    await expect(failed).toContainText("E1003");
    await expect(page.getByTestId("quarantine")).toContainText("Qwen Plus");
  });

  test("价格榜标签：文本 / 视频 / 图像在同一位置切换，按秒 / 按张计价，同步到 URL", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await gotoHydrated(page, "/");
    // 导航里不再有单独的视频/图像页
    await expect(page.getByRole("link", { name: "视频/图像" })).toHaveCount(0);
    const tabs = page.getByTestId("board-tabs");
    await expect(tabs.getByRole("tab", { name: /^文本模型/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await tabs.getByRole("tab", { name: /^视频/ }).click();
    await expect(page).toHaveURL(/\/\?kind=video$/);
    const table = page.getByTestId("media-table");
    await expect(table).toHaveAttribute("data-kind", "video");
    await expect(page.getByTestId("price-table")).toHaveCount(0);
    await expect(table.locator("tbody tr")).toHaveCount(5);
    await expect(table.locator("thead")).toContainText("每秒");
    const h3 = table.locator('tr[data-id="official:minimax/minimax-h3"]');
    await expect(h3).toContainText("MiniMax-H3");
    await expect(h3).toContainText("768p");
    await expect(h3).toContainText("2k");
    await page.getByRole("button", { name: "$ USD" }).click();
    // 列：厂商 · 平台 · 每秒 …
    await expect(h3.locator("td").nth(1)).toHaveText("官方");
    await expect(h3.locator("td").nth(2).locator(".cur-USD")).toHaveText("$0.0800");
    await expect(h3.locator("td").nth(2).locator(".cur-CNY")).toBeHidden();
    // 默认按每秒价格升序
    await expect(table.locator("tbody tr").first()).toContainText("MiniMax-H3");
    await tabs.getByRole("tab", { name: /^图像/ }).click();
    await expect(page).toHaveURL(/kind=image/);
    await expect(table).toHaveAttribute("data-kind", "image");
    await expect(table.locator("thead")).toContainText("每张");
    await expect(table.locator("tbody tr")).toHaveCount(5);
    await page.getByPlaceholder("搜索模型或厂商").fill("stability");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await page.reload();
    await expect(tabs.getByRole("tab", { name: /^图像/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByPlaceholder("搜索模型或厂商")).toHaveValue("stability");
    // 切回文本：关键字保留，视频/图像的参数清掉
    await tabs.getByRole("tab", { name: /^文本模型/ }).click();
    await expect(page).toHaveURL(/\/\?q=stability$/);
    await expect(page.getByTestId("price-table")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("视频/图像变动并入变动页；旧的 /media/ 链接跳转到价格榜视频标签", async ({ page }) => {
    await page.goto("/changes/");
    await expect(page.getByTestId("media-changes")).toContainText("MiniMax-H3");
    await page.goto("/media/");
    await expect(page).toHaveURL(/\/\?kind=video$/);
    await expect(page.getByTestId("media-table")).toHaveAttribute("data-kind", "video");
    await page.goto("/en/media/");
    await expect(page).toHaveURL(/\/en\/\?kind=video$/);
  });

  test("视频/图像不进入文本价格榜和计算器", async ({ page }) => {
    await gotoHydrated(page, "/");
    await expect(page.getByTestId("price-table")).not.toContainText("MiniMax-H3");
    await gotoHydrated(page, "/en/?kind=video");
    await expect(page.getByTestId("media-table").locator("thead")).toContainText("Per second");
  });

  test("统一搜索：文本标签下命中视频/图像模型时给出入口，点击切换标签并带上关键字", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await gotoHydrated(page, "/");
    await expect(page.getByTestId("media-matches")).toHaveCount(0);
    await page.getByPlaceholder(/搜索模型/).fill("MiniMax H3");
    const matches = page.getByTestId("media-matches");
    await expect(matches).toContainText("2 个报价匹配「MiniMax H3」");
    await expect(matches).toContainText("MiniMax-H3");
    await expect(matches).toContainText("/秒");
    await expect(page.getByTestId("price-table")).not.toContainText("MiniMax-H3");
    await matches.getByRole("link", { name: /查看全部/ }).click();
    await expect(page).toHaveURL(/\/\?kind=video&q=MiniMax\+H3$/);
    await expect(
      page.getByTestId("board-tabs").getByRole("tab", { name: /^视频/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByPlaceholder("搜索模型或厂商")).toHaveValue("MiniMax H3");
    const table = page.getByTestId("media-table");
    await expect(table.locator("tbody tr")).toHaveCount(2);
    await page.getByPlaceholder("搜索模型或厂商").fill("");
    await expect(page).toHaveURL(/\/\?kind=video$/);
    await gotoHydrated(page, "/en/");
    await page.getByPlaceholder(/Search models/).fill("flux");
    await page
      .getByTestId("media-matches")
      .getByRole("link", { name: /View all/ })
      .click();
    await expect(page).toHaveURL(/\/en\/\?kind=image&q=flux$/);
    await expect(page.getByTestId("media-table")).toHaveAttribute("data-kind", "image");
    expect(errors).toEqual([]);
  });

  test("404 页面", async ({ page }) => {
    const res = await page.goto("/models/nope/nope/");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("页面不存在");
  });
});

test.describe("手机 375px @mobile", () => {
  test("表格第一列固定，其余列横向滚动；筛选收进抽屉 @mobile", async ({ page }) => {
    await gotoHydrated(page, "/");
    const scroll = page.getByTestId("table-scroll");
    const overflow = await scroll.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(true);
    const firstCell = bodyRows(page).first().locator("th");
    const before = await firstCell.boundingBox();
    await scroll.evaluate((el) => el.scrollBy(200, 0));
    const after = await firstCell.boundingBox();
    expect(after?.x).toBe(before?.x);
    await expect(page.getByLabel("仅免费")).toBeHidden();
    await page.getByRole("button", { name: "筛选" }).click();
    await expect(page.getByLabel("仅免费")).toBeVisible();
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(pageOverflow).toBe(false);
  });
});
