/**
 * 生成 tests/fixtures/data/ 下的样例数据（完全符合 shared schema）。
 * 用法：pnpm --filter @aipb/site exec tsx scripts/generate-fixtures.ts
 * 历史变更点和变动事件由同一份定义推导，保证前后一致。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ChangesMonthFileSchema,
  FxFileSchema,
  HistoryFileSchema,
  LatestFileSchema,
  QuarantineFileSchema,
  StatusFileSchema,
  pctChange,
  type ChangeEvent,
  type ChangeField,
  type Currency,
  type FxRate,
  type Offering,
  type PricePoint,
  type PriceSet,
  type QuarantineEntry,
  type Tier,
} from "@aipb/shared";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "data");
const GENERATED_AT = "2026-10-18T00:04:12Z";
const DATA_DATE = "2026-10-18";
const FETCHED_AT = "2026-10-18T00:01:33Z";
/** firstSeenAt 早于这个日期的报价不生成 new_model 事件（视为数据开始前就存在） */
const EVENTS_START = "2026-08-01";

type Prices = readonly [
  input: number | null,
  output: number | null,
  cacheRead?: number | null,
  cacheWrite?: number | null,
];

interface Def {
  readonly platform: string;
  readonly vendor: string;
  readonly model: string;
  readonly name: string;
  readonly source: string;
  readonly currency: Currency;
  readonly context: number | null;
  readonly maxOutput?: number | null;
  /** [生效日期, 价格] 变更点；最后一个就是当前价格 */
  readonly history: readonly (readonly [string, Prices])[];
  readonly tiers?: readonly Tier[];
  readonly status?: Offering["status"];
  readonly missingDays?: number;
  readonly stale?: boolean;
  readonly fetchedAt?: string;
  readonly notes?: string;
  readonly url: string;
  readonly modalities?: readonly string[];
}

const LITELLM =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const OR = (slug: string): string => `https://openrouter.ai/${slug}`;
const SF = "https://siliconflow.cn/pricing";

const tier = (
  min: number,
  max: number | null,
  input: number,
  output: number,
  cacheRead: number | null = null,
): Tier => ({
  minInputTokens: min,
  maxInputTokens: max,
  input,
  output,
  cacheRead,
  cacheWrite: null,
});

const DEFS: readonly Def[] = [
  {
    platform: "official",
    vendor: "openai",
    model: "gpt-5",
    name: "GPT-5",
    source: "litellm",
    currency: "USD",
    context: 400_000,
    maxOutput: 128_000,
    url: LITELLM,
    history: [["2026-08-07", [1.25, 10, 0.125]]],
  },
  {
    platform: "official",
    vendor: "openai",
    model: "gpt-5-mini",
    name: "GPT-5 mini",
    source: "litellm",
    currency: "USD",
    context: 400_000,
    maxOutput: 128_000,
    url: LITELLM,
    history: [["2026-08-07", [0.25, 2, 0.025]]],
  },
  {
    platform: "official",
    vendor: "openai",
    model: "gpt-4o-mini",
    name: "GPT-4o mini",
    source: "litellm",
    currency: "USD",
    context: 128_000,
    maxOutput: 16_384,
    url: LITELLM,
    history: [
      ["2026-05-01", [0.3, 1.2, 0.15]],
      ["2026-08-15", [0.15, 0.6, 0.075]],
    ],
  },
  {
    platform: "official",
    vendor: "anthropic",
    model: "claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    source: "litellm",
    currency: "USD",
    context: 1_000_000,
    maxOutput: 64_000,
    url: LITELLM,
    history: [["2026-06-01", [3, 15, 0.3, 3.75]]],
    tiers: [tier(0, 200_000, 3, 15, 0.3), tier(200_000, null, 6, 22.5, 0.6)],
  },
  {
    platform: "official",
    vendor: "anthropic",
    model: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    source: "litellm",
    currency: "USD",
    context: 200_000,
    maxOutput: 64_000,
    url: LITELLM,
    history: [["2026-08-20", [1, 5, 0.1, 1.25]]],
  },
  {
    platform: "official",
    vendor: "anthropic",
    model: "claude-opus-4.1",
    name: "Claude Opus 4.1",
    source: "litellm",
    currency: "USD",
    context: 200_000,
    maxOutput: 32_000,
    url: LITELLM,
    history: [["2026-06-01", [15, 75, 1.5, 18.75]]],
  },
  {
    platform: "official",
    vendor: "google",
    model: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    source: "litellm",
    currency: "USD",
    context: 1_048_576,
    maxOutput: 65_536,
    url: LITELLM,
    history: [["2026-06-01", [1.25, 10, 0.31]]],
    tiers: [tier(0, 200_000, 1.25, 10, 0.31), tier(200_000, null, 2.5, 15, 0.625)],
  },
  {
    platform: "official",
    vendor: "google",
    model: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    source: "litellm",
    currency: "USD",
    context: 1_048_576,
    maxOutput: 65_536,
    url: LITELLM,
    history: [
      ["2026-06-01", [0.15, 0.6, 0.0375]],
      ["2026-09-01", [0.3, 2.5, 0.075]],
    ],
  },
  {
    platform: "official",
    vendor: "google",
    model: "gemini-2.0-flash-exp",
    name: "Gemini 2.0 Flash Experimental",
    source: "litellm",
    currency: "USD",
    context: 1_048_576,
    maxOutput: 8192,
    url: LITELLM,
    history: [["2026-06-01", [0, 0, 0]]],
  },
  {
    platform: "official",
    vendor: "x-ai",
    model: "grok-4",
    name: "Grok 4",
    source: "litellm",
    currency: "USD",
    context: 256_000,
    url: LITELLM,
    history: [["2026-07-10", [3, 15, 0.75]]],
  },
  {
    platform: "official",
    vendor: "mistral",
    model: "mistral-large",
    name: "Mistral Large",
    source: "litellm",
    currency: "USD",
    context: 128_000,
    url: LITELLM,
    history: [["2026-06-01", [2, 6]]],
    status: "missing",
    missingDays: 1,
    fetchedAt: "2026-10-17T00:01:20Z",
  },
  {
    platform: "official",
    vendor: "cohere",
    model: "command-r-plus",
    name: "Command R+",
    source: "litellm",
    currency: "USD",
    context: 128_000,
    url: LITELLM,
    history: [["2026-06-01", [2.5, 10]]],
    status: "removed",
    missingDays: 3,
    fetchedAt: "2026-10-12T00:01:20Z",
  },
  {
    platform: "official",
    vendor: "amazon",
    model: "nova-micro",
    name: "Amazon Nova Micro",
    source: "litellm",
    currency: "USD",
    context: 128_000,
    url: LITELLM,
    history: [["2026-06-01", [0.035, null]]],
    notes: "输出价暂缺",
  },
  {
    platform: "openrouter",
    vendor: "openai",
    model: "gpt-5",
    name: "GPT-5",
    source: "openrouter",
    currency: "USD",
    context: 400_000,
    url: OR("openai/gpt-5"),
    history: [["2026-08-07", [1.25, 10, 0.125]]],
  },
  {
    platform: "openrouter",
    vendor: "anthropic",
    model: "claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    source: "openrouter",
    currency: "USD",
    context: 1_000_000,
    url: OR("anthropic/claude-sonnet-4.5"),
    history: [["2026-06-01", [3, 15, 0.3, 3.75]]],
  },
  {
    platform: "openrouter",
    vendor: "deepseek",
    model: "deepseek-chat",
    name: "DeepSeek-V3",
    source: "openrouter",
    currency: "USD",
    context: 163_840,
    url: OR("deepseek/deepseek-chat"),
    history: [
      ["2026-07-01", [0.3, 1.2]],
      ["2026-10-13", [0.27, 1.1]],
    ],
  },
  {
    platform: "openrouter",
    vendor: "meta",
    model: "llama-3.3-70b-instruct",
    name: 'Llama 3.3 70B <Instruct> & "Free"',
    source: "openrouter",
    currency: "USD",
    context: 131_072,
    url: OR("meta-llama/llama-3.3-70b-instruct:free"),
    history: [["2026-10-18", [0, 0]]],
    notes: "<b>限速</b> 20 次/分钟 & 每天 50 次",
  },
  {
    platform: "openrouter",
    vendor: "alibaba",
    model: "qwen3-max",
    name: "Qwen3 Max",
    source: "openrouter",
    currency: "USD",
    context: 262_144,
    url: OR("qwen/qwen3-max"),
    history: [["2026-09-10", [1.2, 6, 0.24]]],
  },
  {
    platform: "openrouter",
    vendor: "moonshot",
    model: "kimi-k2",
    name: "Kimi K2",
    source: "openrouter",
    currency: "USD",
    context: 262_144,
    url: OR("moonshotai/kimi-k2"),
    history: [["2026-07-15", [0.6, 2.5]]],
  },
  {
    platform: "official",
    vendor: "deepseek",
    model: "deepseek-chat",
    name: "DeepSeek-V3",
    source: "deepseek",
    currency: "CNY",
    context: 128_000,
    maxOutput: 8192,
    url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
    notes: "北京时间 00:30-08:30 错峰时段另有优惠",
    history: [
      ["2026-07-01", [2, 16, 0.5]],
      ["2026-10-12", [2, 8, 0.5]],
    ],
  },
  {
    platform: "official",
    vendor: "deepseek",
    model: "deepseek-reasoner",
    name: "DeepSeek-R1",
    source: "deepseek",
    currency: "CNY",
    context: 128_000,
    maxOutput: 65_536,
    url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
    history: [
      ["2026-07-01", [4, 16, 2]],
      ["2026-10-18", [4, 16, 1]],
    ],
  },
  {
    platform: "official",
    vendor: "alibaba",
    model: "qwen3-max",
    name: "Qwen3 Max",
    source: "aliyun",
    currency: "CNY",
    context: 262_144,
    maxOutput: 65_536,
    url: "https://help.aliyun.com/zh/model-studio/models",
    history: [
      ["2026-09-10", [10, 40]],
      ["2026-10-17", [6, 24]],
    ],
    tiers: [tier(0, 32_000, 6, 24), tier(32_000, 128_000, 10, 40), tier(128_000, null, 15, 60)],
  },
  {
    platform: "official",
    vendor: "alibaba",
    model: "qwen-plus",
    name: "Qwen Plus",
    source: "aliyun",
    currency: "CNY",
    context: 131_072,
    url: "https://help.aliyun.com/zh/model-studio/models",
    history: [["2026-06-01", [0.8, 2, 0.16]]],
  },
  {
    platform: "official",
    vendor: "alibaba",
    model: "qwen-turbo",
    name: "Qwen Turbo",
    source: "aliyun",
    currency: "CNY",
    context: 1_000_000,
    url: "https://help.aliyun.com/zh/model-studio/models",
    history: [
      ["2026-06-01", [0.5, 1]],
      ["2026-10-18", [0.3, 0.6]],
    ],
  },
  {
    platform: "official",
    vendor: "zhipu",
    model: "glm-4.6",
    name: "GLM-4.6",
    source: "zhipu",
    currency: "CNY",
    context: 200_000,
    maxOutput: 128_000,
    url: "https://open.bigmodel.cn/pricing",
    history: [["2026-09-30", [2, 8, 0.4]]],
  },
  {
    platform: "official",
    vendor: "zhipu",
    model: "glm-4-flash",
    name: "GLM-4-Flash",
    source: "zhipu",
    currency: "CNY",
    context: 128_000,
    url: "https://open.bigmodel.cn/pricing",
    history: [["2026-06-01", [0, 0]]],
  },
  {
    platform: "official",
    vendor: "moonshot",
    model: "kimi-k2",
    name: "Kimi K2",
    source: "moonshot",
    currency: "CNY",
    context: 262_144,
    url: "https://platform.moonshot.cn/docs/pricing/chat",
    history: [["2026-07-15", [4, 16, 1]]],
  },
  {
    platform: "official",
    vendor: "bytedance",
    model: "doubao-seed-1.6",
    name: "Doubao Seed 1.6",
    source: "volcengine",
    currency: "CNY",
    context: 256_000,
    url: "https://www.volcengine.com/docs/82379/1544106",
    history: [["2026-08-01", [0.8, 8, 0.16]]],
    stale: true,
    fetchedAt: "2026-10-10T00:02:05Z",
    tiers: [
      tier(0, 32_000, 0.8, 8, 0.16),
      tier(32_000, 128_000, 1.2, 16, 0.16),
      tier(128_000, 256_000, 2.4, 24, 0.16),
    ],
  },
  {
    platform: "official",
    vendor: "bytedance",
    model: "doubao-1.5-pro-32k",
    name: "Doubao 1.5 Pro 32K",
    source: "volcengine",
    currency: "CNY",
    context: 32_000,
    url: "https://www.volcengine.com/docs/82379/1544106",
    history: [["2026-06-01", [0.8, 2, 0.16]]],
    stale: true,
    fetchedAt: "2026-10-10T00:02:05Z",
  },
  {
    platform: "official",
    vendor: "baidu",
    model: "ernie-4.5-turbo",
    name: "ERNIE 4.5 Turbo",
    source: "qianfan",
    currency: "CNY",
    context: 128_000,
    url: "https://cloud.baidu.com/doc/WENXINWORKSHOP/s/hlrk4akp7",
    history: [["2026-06-01", [0.8, 3.2]]],
    stale: true,
    fetchedAt: "2026-10-17T00:01:50Z",
  },
  {
    platform: "official",
    vendor: "minimax",
    model: "minimax-m2",
    name: "MiniMax-M2",
    source: "manual",
    currency: "CNY",
    context: 204_800,
    url: "https://platform.minimaxi.com/document/price",
    history: [["2026-10-18", [2.1, 8.4, 0.21]]],
  },
  {
    platform: "official",
    vendor: "tencent",
    model: "hunyuan-turbos",
    name: "Hunyuan TurboS",
    source: "manual",
    currency: "CNY",
    context: 32_000,
    url: "https://cloud.tencent.com/document/product/1729/97731",
    history: [
      ["2026-09-01", [0.6, 1.6]],
      ["2026-10-18", [0.8, 2]],
    ],
  },
  {
    platform: "siliconflow",
    vendor: "deepseek",
    model: "deepseek-chat",
    name: "DeepSeek-V3",
    source: "siliconflow",
    currency: "CNY",
    context: 128_000,
    url: SF,
    history: [["2026-07-01", [2, 8]]],
  },
  {
    platform: "siliconflow",
    vendor: "alibaba",
    model: "qwen2.5-7b-instruct",
    name: "Qwen2.5-7B-Instruct",
    source: "siliconflow",
    currency: "CNY",
    context: 32_768,
    url: SF,
    history: [["2026-06-01", [0, 0]]],
  },
  {
    platform: "siliconflow",
    vendor: "zhipu",
    model: "glm-4.6",
    name: "GLM-4.6",
    source: "siliconflow",
    currency: "CNY",
    context: 200_000,
    url: SF,
    history: [["2026-10-18", [3.5, 14]]],
  },
];

const toPriceSet = (p: Prices): PriceSet => ({
  input: p[0],
  output: p[1],
  cacheRead: p[2] ?? null,
  cacheWrite: p[3] ?? null,
});
const offeringId = (d: Def): string => `${d.platform}:${d.vendor}/${d.model}`;
const slug = (d: Def): string => `${d.vendor}/${d.model}`;
const at = (date: string, time = "00:02:10"): string => `${date}T${time}Z`;

function toOffering(d: Def): Offering {
  const last = d.history.at(-1);
  if (!last) throw new Error(`${offeringId(d)} 没有历史`);
  const prices = toPriceSet(last[1]);
  return {
    id: offeringId(d),
    vendor: d.vendor,
    model: d.model,
    modelSlug: slug(d),
    displayName: d.name,
    platform: d.platform,
    source: d.source,
    currency: d.currency,
    ...prices,
    tiers: d.tiers ? [...d.tiers] : null,
    contextWindow: d.context,
    maxOutput: d.maxOutput ?? null,
    modalities: [...(d.modalities ?? ["text"])],
    isFree: prices.input === 0 && prices.output === 0,
    stale: d.stale ?? false,
    status: d.status ?? "active",
    missingDays: d.missingDays ?? 0,
    sourceUrl: d.url,
    notes: d.notes ?? null,
    firstSeenAt: d.history[0]?.[0] ?? DATA_DATE,
    fetchedAt: d.fetchedAt ?? FETCHED_AT,
    publishedAt: GENERATED_AT,
  };
}

function priceFields(oldP: PriceSet, newP: PriceSet): ChangeField[] {
  return (["input", "output", "cacheRead", "cacheWrite"] as const)
    .filter((f) => oldP[f] !== newP[f])
    .map((f) => ({ field: f, old: oldP[f], new: newP[f], pct: pctChange(oldP[f], newP[f]) }));
}

function baseEvent(
  d: Def,
  type: ChangeEvent["type"],
  detectedAt: string,
  fields: ChangeField[],
  seq = 1,
): ChangeEvent {
  return {
    id: `${detectedAt.slice(0, 10)}-${offeringId(d)}-${seq}`,
    type,
    offeringId: offeringId(d),
    vendor: d.vendor,
    modelSlug: slug(d),
    displayName: d.name,
    platform: d.platform,
    currency: d.currency,
    fields,
    confirmedFromQuarantine: false,
    detectedAt,
  };
}

function derivedEvents(d: Def): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const first = d.history[0];
  if (first && first[0] >= EVENTS_START) events.push(baseEvent(d, "new_model", at(first[0]), []));
  for (let i = 1; i < d.history.length; i += 1) {
    const prev = d.history[i - 1];
    const cur = d.history[i];
    if (!prev || !cur) continue;
    const fields = priceFields(toPriceSet(prev[1]), toPriceSet(cur[1]));
    const up = fields.some((f) => f.old !== null && f.new !== null && f.new > f.old);
    events.push(baseEvent(d, up ? "price_up" : "price_down", at(cur[0]), fields));
  }
  return events;
}

const byId = (id: string): Def => {
  const def = DEFS.find((d) => offeringId(d) === id);
  if (!def) throw new Error(`未知 offering ${id}`);
  return def;
};

const manualEvents: ChangeEvent[] = [
  baseEvent(byId("official:cohere/command-r-plus"), "removed", at("2026-10-15"), []),
  baseEvent(byId("official:moonshot/kimi-k2"), "context_change", at("2026-10-15"), [
    { field: "contextWindow", old: 131_072, new: 262_144, pct: 1 },
  ]),
  baseEvent(byId("openrouter:moonshot/kimi-k2"), "removed", at("2026-10-10"), []),
  baseEvent(byId("openrouter:moonshot/kimi-k2"), "restored", at("2026-10-18", "00:02:11"), []),
];

const events = [...DEFS.flatMap(derivedEvents), ...manualEvents].map((e) =>
  e.offeringId === "official:alibaba/qwen3-max" && e.type === "price_down"
    ? { ...e, confirmedFromQuarantine: true }
    : e,
);

function write(rel: string, value: unknown): void {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fxHistory(): FxRate[] {
  return Array.from({ length: 90 }, (_, i) => {
    const date = new Date(Date.parse("2026-10-17T00:00:00Z") - (89 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const usdCny = Number((7.18 - i * 0.0007 + Math.sin(i / 6) * 0.01).toFixed(4));
    return { date, usdCny, provider: i === 40 ? "er-api" : "frankfurter" } satisfies FxRate;
  });
}

function main(): void {
  rmSync(OUT, { recursive: true, force: true });
  const offerings = DEFS.map(toOffering);
  write(
    "latest.json",
    LatestFileSchema.parse({
      schemaVersion: "1.0.0",
      generatedAt: GENERATED_AT,
      dataDate: DATA_DATE,
      offerings,
    }),
  );

  for (const [modelSlug, defs] of Map.groupBy(DEFS, slug)) {
    const series = Object.fromEntries(
      defs.map((d) => [
        offeringId(d),
        d.history.map(([effectiveDate, p]): PricePoint => ({ effectiveDate, ...toPriceSet(p) })),
      ]),
    );
    write(`history/${modelSlug}.json`, HistoryFileSchema.parse({ modelSlug, series }));
  }

  for (const [month, list] of Map.groupBy(events, (e) => e.detectedAt.slice(0, 7))) {
    const sorted = list.toSorted((a, b) => a.detectedAt.localeCompare(b.detectedAt));
    write(`changes/${month}.json`, ChangesMonthFileSchema.parse({ month, events: sorted }));
  }

  const history = fxHistory();
  const latestFx = history.at(-1);
  write(
    "fx.json",
    FxFileSchema.parse({ latest: latestFx, lastSuccessAt: "2026-10-18T00:00:45Z", history }),
  );

  const quarantine: QuarantineEntry[] = [
    {
      offeringId: "official:alibaba/qwen-plus",
      fields: [{ field: "input", old: 0.8, new: 0.08, pct: -0.9 }],
      candidate: { input: 0.08, output: 2, cacheRead: 0.16, cacheWrite: null },
      firstSeenAt: "2026-10-18T00:02:00Z",
      lastSeenAt: "2026-10-18T00:02:00Z",
      confirmations: 1,
    },
  ];
  write("quarantine.json", QuarantineFileSchema.parse({ entries: quarantine }));

  const ok = (
    id: string,
    kind: "api" | "html" | "browser" | "manual",
    count: number,
    ms: number,
  ) => ({
    id,
    kind,
    status: "ok" as const,
    offeringCount: count,
    durationMs: ms,
    errorCode: null,
    errorMessage: null,
    lastSuccessAt: "2026-10-18T00:01:33Z",
    consecutiveFailures: 0,
  });
  write(
    "status.json",
    StatusFileSchema.parse({
      run: {
        id: "18594412345",
        startedAt: "2026-10-18T00:00:41Z",
        finishedAt: "2026-10-18T00:03:58Z",
        durationMs: 197_000,
        result: "partial",
      },
      sources: [
        ok("litellm", "api", 13, 2310),
        ok("openrouter", "api", 6, 1840),
        ok("deepseek", "html", 2, 1830),
        ok("aliyun", "browser", 3, 21_400),
        ok("zhipu", "html", 2, 2210),
        ok("moonshot", "html", 1, 1500),
        ok("siliconflow", "html", 3, 3100),
        ok("manual", "manual", 2, 12),
        {
          id: "volcengine",
          kind: "browser",
          status: "failed",
          offeringCount: 0,
          durationMs: 60_000,
          errorCode: "E1003",
          errorMessage: "疑似被反爬拦截（HTTP 403）",
          lastSuccessAt: "2026-10-10T00:02:05Z",
          consecutiveFailures: 8,
        },
        {
          id: "qianfan",
          kind: "html",
          status: "rejected",
          offeringCount: 1,
          durationMs: 2800,
          errorCode: "E3004",
          errorMessage: "模型数从 12 骤降到 1，整个源被拒绝",
          lastSuccessAt: "2026-10-17T00:01:50Z",
          consecutiveFailures: 1,
        },
      ],
      quarantine,
      warnings: [
        {
          code: "W3003",
          sourceId: "aliyun",
          offeringId: "official:alibaba/qwen-plus",
          message: "输入价下降 90%，已暂扣，等待确认",
        },
        {
          code: "W3007",
          sourceId: null,
          offeringId: "official:mistral/mistral-large",
          message: "官方价与 OpenRouter 价差 34%",
        },
      ],
    }),
  );
  process.stdout.write(
    `fixtures: ${offerings.length} offerings, ${events.length} events → ${OUT}\n`,
  );
}

main();
