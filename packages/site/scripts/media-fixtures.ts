/**
 * tests/fixtures/data/media/ 的样例数据（视频/图像，价格取自 2026-10-18 的 LiteLLM 实测值）。
 * 由 generate-fixtures.ts 调用；历史变更点和变动事件由同一份定义推导。
 */
import {
  ChangesMonthFileSchema,
  HistoryFileSchema,
  MediaLatestFileSchema,
  QuarantineFileSchema,
  SCHEMA_VERSION,
  pctChange,
  type ChangeEvent,
  type Currency,
  type MediaKind,
  type MediaOffering,
  type MediaTier,
  type PricePoint,
} from "@aipb/shared";

type Write = (rel: string, value: unknown) => void;

interface MediaDef {
  readonly vendor: string;
  readonly model: string;
  readonly name: string;
  readonly kind: MediaKind;
  readonly currency?: Currency;
  /** [生效日期, 生成价, 输入图价] 变更点；最后一个就是当前价格 */
  readonly history: readonly (readonly [string, number, number | null])[];
  readonly tiers?: readonly MediaTier[];
  readonly status?: MediaOffering["status"];
  readonly stale?: boolean;
  readonly url: string;
}

const GENERATED_AT = "2026-10-18T00:04:12Z";
const FETCHED_AT = "2026-10-18T00:01:33Z";
const EVENTS_START = "2026-08-01";
const at = (date: string): string => `${date}T00:02:10Z`;

const DEFS: readonly MediaDef[] = [
  {
    vendor: "minimax",
    model: "minimax-h3",
    name: "MiniMax-H3",
    kind: "video",
    history: [
      ["2026-09-01", 0.1, 0.04],
      ["2026-10-18", 0.08, 0.04],
    ],
    tiers: [
      { label: "768p", output: 0.08 },
      { label: "2k", output: 0.13 },
    ],
    url: "https://platform.minimax.io/docs/guides/pricing-paygo",
  },
  {
    vendor: "minimax",
    model: "minimax-h3-max",
    name: "MiniMax-H3-Max",
    kind: "video",
    history: [["2026-10-05", 0.08, 0.074]],
    tiers: [
      { label: "480p", output: 0.05 },
      { label: "768p", output: 0.08 },
    ],
    url: "https://platform.minimax.io/docs/guides/pricing-paygo",
  },
  {
    vendor: "google",
    model: "veo-3.1-generate-001",
    name: "veo-3.1-generate-001",
    kind: "video",
    history: [["2026-07-01", 0.4, null]],
    tiers: [{ label: "4k", output: 0.6 }],
    url: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  {
    vendor: "bytedance",
    model: "doubao-seedance-2.0-260128",
    name: "doubao-seedance-2-0-260128",
    kind: "video",
    history: [["2026-07-01", 0.141943, null]],
    tiers: [
      { label: "480p", output: 0.0660034 },
      { label: "720p", output: 0.141943 },
      { label: "1080p", output: 0.354086 },
      { label: "4k", output: 0.722057 },
      { label: "8k", output: 1.9 },
    ],
    url: "https://www.volcengine.com/docs/82379/1544106",
  },
  {
    vendor: "runway",
    model: "gen4.5",
    name: "gen4.5",
    kind: "video",
    history: [["2026-07-01", 0.12, null]],
    stale: true,
    url: "https://docs.dev.runwayml.com/guides/pricing/",
  },
  {
    vendor: "openai",
    model: "sora-2",
    name: "sora-2",
    kind: "video",
    history: [["2026-07-01", 0.1, null]],
    status: "removed",
    url: "https://openai.com/api/pricing/",
  },
  {
    vendor: "openai",
    model: "gpt-image-1",
    name: "gpt-image-1",
    kind: "image",
    history: [["2026-07-01", 0.011, null]],
    tiers: [
      { label: "low 1024x1024", output: 0.011 },
      { label: "medium 1024x1024", output: 0.042 },
      { label: "high 1024x1536", output: 0.25 },
    ],
    url: "https://openai.com/api/pricing/",
  },
  {
    vendor: "black-forest-labs",
    model: "flux-pro-1.1",
    name: "flux-pro-1.1",
    kind: "image",
    history: [["2026-10-05", 0.04, null]],
    url: "https://bfl.ai/pricing",
  },
  {
    vendor: "stability",
    model: "sd3",
    name: "sd3",
    kind: "image",
    history: [
      ["2026-07-01", 0.08, null],
      ["2026-10-01", 0.065, null],
    ],
    url: "https://platform.stability.ai/pricing",
  },
  {
    vendor: "google",
    model: "gemini-3-pro-image",
    name: "gemini-3-pro-image",
    kind: "image",
    history: [["2026-07-01", 0.134, 0.0011]],
    url: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  {
    vendor: "bytedance",
    model: "doubao-seedream-4.0",
    name: "doubao-seedream-4.0",
    kind: "image",
    currency: "CNY",
    history: [["2026-07-01", 0.2, null]],
    url: "https://www.volcengine.com/docs/82379/1544106",
  },
];

const offeringId = (d: MediaDef): string => `official:${d.vendor}/${d.model}`;
const slug = (d: MediaDef): string => `${d.vendor}/${d.model}`;

function toOffering(d: MediaDef): MediaOffering {
  const last = d.history.at(-1);
  if (!last) throw new Error(`${offeringId(d)} 没有历史`);
  return {
    id: offeringId(d),
    vendor: d.vendor,
    model: d.model,
    modelSlug: slug(d),
    displayName: d.name,
    platform: "official",
    source: "litellm",
    currency: d.currency ?? "USD",
    kind: d.kind,
    unit: d.kind === "video" ? "per_second" : "per_image",
    input: last[2],
    output: last[1],
    tiers: d.tiers ? [...d.tiers] : null,
    modalities: ["text"],
    isFree: last[1] === 0,
    stale: d.stale ?? false,
    status: d.status ?? "active",
    missingDays: d.status === "removed" ? 3 : 0,
    sourceUrl: d.url,
    notes: null,
    firstSeenAt: d.history[0]?.[0] ?? "2026-10-18",
    fetchedAt: d.stale ? "2026-10-14T00:01:33Z" : FETCHED_AT,
    publishedAt: GENERATED_AT,
  };
}

function event(
  d: MediaDef,
  type: ChangeEvent["type"],
  date: string,
  fields: ChangeEvent["fields"],
): ChangeEvent {
  return {
    id: `${date}-${offeringId(d)}-1`,
    type,
    offeringId: offeringId(d),
    vendor: d.vendor,
    modelSlug: slug(d),
    displayName: d.name,
    platform: "official",
    currency: d.currency ?? "USD",
    fields,
    confirmedFromQuarantine: false,
    detectedAt: at(date),
  };
}

function derivedEvents(d: MediaDef): ChangeEvent[] {
  const first = d.history[0];
  const created = first && first[0] >= EVENTS_START ? [event(d, "new_model", first[0], [])] : [];
  const priced = d.history.slice(1).flatMap((cur, i) => {
    const prev = d.history[i];
    if (!prev || prev[1] === cur[1]) return [];
    const field = {
      field: "output" as const,
      old: prev[1],
      new: cur[1],
      pct: pctChange(prev[1], cur[1]),
    };
    return [event(d, cur[1] > prev[1] ? "price_up" : "price_down", cur[0], [field])];
  });
  return [...created, ...priced];
}

export function writeMediaFixtures(write: Write): void {
  write(
    "media/latest.json",
    MediaLatestFileSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      generatedAt: GENERATED_AT,
      dataDate: "2026-10-18",
      offerings: DEFS.map(toOffering),
    }),
  );
  for (const d of DEFS) {
    const series = {
      [offeringId(d)]: d.history.map(([effectiveDate, output, input]): PricePoint => ({
        effectiveDate,
        input,
        output,
        cacheRead: null,
        cacheWrite: null,
      })),
    };
    write(`media/history/${slug(d)}.json`, HistoryFileSchema.parse({ modelSlug: slug(d), series }));
  }
  const events = DEFS.flatMap(derivedEvents);
  for (const [month, list] of Map.groupBy(events, (e) => e.detectedAt.slice(0, 7))) {
    const sorted = list.toSorted((a, b) => a.detectedAt.localeCompare(b.detectedAt));
    write(`media/changes/${month}.json`, ChangesMonthFileSchema.parse({ month, events: sorted }));
  }
  write("media/quarantine.json", QuarantineFileSchema.parse({ entries: [] }));
}
