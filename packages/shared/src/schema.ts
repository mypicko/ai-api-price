/**
 * 全项目唯一可信的数据结构定义（DEV_DOCUMENT §4、API 文档 §2）。
 * pipeline 写出的文件、site 读取的文件、公开 JSON 接口都以这里为准。
 */
import { z } from "zod";

/** 1.1.0：新增视频/图像生成模型（media/*.json），原有文件结构不变 */
export const SCHEMA_VERSION = "1.1.0";

/** 价格合理上限：USD / 1M tokens（校验规则 V2） */
export const MAX_PRICE_USD_PER_1M = 1000;
/** 视频/图像价格合理上限：USD / 秒 或 USD / 张（校验规则 V2） */
export const MAX_MEDIA_PRICE_USD = 50;

export const CurrencySchema = z.enum(["USD", "CNY"]);
export type Currency = z.infer<typeof CurrencySchema>;

export const RegionSchema = z.enum(["intl", "cn"]);
export type Region = z.infer<typeof RegionSchema>;

export const SourceKindSchema = z.enum(["api", "html", "browser", "manual"]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const RawUnitSchema = z.enum(["per_token", "per_1k", "per_1m"]);
export type RawUnit = z.infer<typeof RawUnitSchema>;

const IdSchema = z.string().regex(/^[a-z0-9][a-z0-9.-]*$/, "ID 只能包含小写字母、数字、点和横线");
const IsoDateTimeSchema = z.iso.datetime();
const IsoDateSchema = z.iso.date();

/** 价格：null = 未知 / 不提供，0 = 免费；单位见上下文 */
export const PriceSchema = z.number().nonnegative().finite().nullable();

export const PRICE_FIELDS = ["input", "output", "cacheRead", "cacheWrite"] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];

export const PriceSetSchema = z.object({
  input: PriceSchema,
  output: PriceSchema,
  cacheRead: PriceSchema,
  cacheWrite: PriceSchema,
});
export type PriceSet = z.infer<typeof PriceSetSchema>;

export const TierSchema = PriceSetSchema.extend({
  minInputTokens: z.number().int().nonnegative(),
  maxInputTokens: z.number().int().positive().nullable(),
});
export type Tier = z.infer<typeof TierSchema>;

// ───────────────────────── 抓取器原始输出 ─────────────────────────

export const RawTierSchema = z.object({
  minInputTokens: z.number().int().nonnegative(),
  maxInputTokens: z.number().int().positive().nullable(),
  input: PriceSchema,
  output: PriceSchema,
  cacheRead: PriceSchema.optional(),
  cacheWrite: PriceSchema.optional(),
});
export type RawTier = z.infer<typeof RawTierSchema>;

export const RawOfferingSchema = z.object({
  vendorHint: z.string().min(1).max(100),
  modelName: z.string().min(1).max(100),
  displayName: z.string().min(1).max(100).optional(),
  currency: CurrencySchema,
  unit: RawUnitSchema,
  input: PriceSchema,
  output: PriceSchema,
  cacheRead: PriceSchema.optional(),
  cacheWrite: PriceSchema.optional(),
  tiers: z.array(RawTierSchema).optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  maxOutput: z.number().int().positive().nullable().optional(),
  modalities: z.array(z.string()).optional(),
  sourceUrl: z.url({ protocol: /^https$/ }),
  notes: z.string().optional(),
  /** 报价所属平台；多平台数据源（转售价）必填，单平台源省略时用源自身的平台 */
  platform: IdSchema.optional(),
});
export type RawOffering = z.infer<typeof RawOfferingSchema>;

// ───────────────────────── 视频/图像生成（按秒 / 按张计费） ─────────────────────────

export const MediaKindSchema = z.enum(["video", "image"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/** per_second = 每秒生成视频；per_image = 每张生成图片 */
export const MediaUnitSchema = z.enum(["per_second", "per_image"]);
export type MediaUnit = z.infer<typeof MediaUnitSchema>;

/** 分档价：按分辨率（"720p"、"4k"）或质量 + 尺寸（"high 1024x1536"）计费 */
export const MediaTierSchema = z.object({
  label: z.string().min(1).max(40),
  output: PriceSchema,
});
export type MediaTier = z.infer<typeof MediaTierSchema>;

/**
 * 抓取器输出的视频/图像报价。价格不做单位换算：
 * output = 每秒 / 每张的生成价（默认档），input = 每张输入参考图的价格。
 */
export const RawMediaOfferingSchema = z.object({
  vendorHint: z.string().min(1).max(100),
  modelName: z.string().min(1).max(100),
  displayName: z.string().min(1).max(100).optional(),
  currency: CurrencySchema,
  media: z.object({ kind: MediaKindSchema, unit: MediaUnitSchema }),
  input: PriceSchema,
  output: PriceSchema,
  tiers: z.array(MediaTierSchema).optional(),
  modalities: z.array(z.string()).optional(),
  sourceUrl: z.url({ protocol: /^https$/ }),
  notes: z.string().optional(),
});
export type RawMediaOffering = z.infer<typeof RawMediaOfferingSchema>;

// ───────────────────────── 已发布实体 ─────────────────────────

export const OfferingStatusSchema = z.enum(["active", "missing", "removed"]);
export type OfferingStatus = z.infer<typeof OfferingStatusSchema>;

/** 价格为原币种、每百万 token */
export const OfferingSchema = PriceSetSchema.extend({
  /** platform:vendor/model */
  id: z.string().min(3),
  vendor: IdSchema,
  model: IdSchema,
  /** vendor/model */
  modelSlug: z.string().min(3),
  displayName: z.string().min(1).max(100),
  platform: IdSchema,
  source: IdSchema,
  currency: CurrencySchema,
  tiers: z.array(TierSchema).nullable(),
  contextWindow: z.number().int().positive().nullable(),
  maxOutput: z.number().int().positive().nullable(),
  modalities: z.array(z.string()),
  isFree: z.boolean(),
  stale: z.boolean(),
  status: OfferingStatusSchema,
  missingDays: z.number().int().nonnegative(),
  sourceUrl: z.url({ protocol: /^https$/ }),
  notes: z.string().max(200).nullable(),
  firstSeenAt: IsoDateSchema,
  fetchedAt: IsoDateTimeSchema,
  publishedAt: IsoDateTimeSchema,
});
export type Offering = z.infer<typeof OfferingSchema>;

/** data/latest.json：包含 removed 的条目（用于判断 restored）；公开接口会过滤掉 removed */
export const LatestFileSchema = z.object({
  schemaVersion: z.string(),
  generatedAt: IsoDateTimeSchema,
  dataDate: IsoDateSchema,
  offerings: z.array(OfferingSchema),
});
export type LatestFile = z.infer<typeof LatestFileSchema>;

/** 视频/图像报价（data/media/latest.json），价格为原币种、按 unit 计价 */
export const MediaOfferingSchema = z.object({
  /** platform:vendor/model（与 latest.json 是两个独立的命名空间） */
  id: z.string().min(3),
  vendor: IdSchema,
  model: IdSchema,
  modelSlug: z.string().min(3),
  displayName: z.string().min(1).max(100),
  platform: IdSchema,
  source: IdSchema,
  currency: CurrencySchema,
  kind: MediaKindSchema,
  unit: MediaUnitSchema,
  /** 每张输入参考图的价格 */
  input: PriceSchema,
  /** 每秒 / 每张的生成价（默认档；来源没有默认档时为最低档） */
  output: PriceSchema,
  /** 按 output 升序 */
  tiers: z.array(MediaTierSchema).nullable(),
  modalities: z.array(z.string()),
  isFree: z.boolean(),
  stale: z.boolean(),
  status: OfferingStatusSchema,
  missingDays: z.number().int().nonnegative(),
  sourceUrl: z.url({ protocol: /^https$/ }),
  notes: z.string().max(200).nullable(),
  firstSeenAt: IsoDateSchema,
  fetchedAt: IsoDateTimeSchema,
  publishedAt: IsoDateTimeSchema,
});
export type MediaOffering = z.infer<typeof MediaOfferingSchema>;

/** data/media/latest.json：结构同 latest.json，offerings 换成 MediaOffering */
export const MediaLatestFileSchema = z.object({
  schemaVersion: z.string(),
  generatedAt: IsoDateTimeSchema,
  dataDate: IsoDateSchema,
  offerings: z.array(MediaOfferingSchema),
});
export type MediaLatestFile = z.infer<typeof MediaLatestFileSchema>;

export const PricePointSchema = PriceSetSchema.extend({
  effectiveDate: IsoDateSchema,
});
export type PricePoint = z.infer<typeof PricePointSchema>;

/** data/history/<vendor>/<model>.json：按 offeringId 分组的变更点序列 */
export const HistoryFileSchema = z.object({
  modelSlug: z.string(),
  series: z.record(z.string(), z.array(PricePointSchema)),
});
export type HistoryFile = z.infer<typeof HistoryFileSchema>;

export const ChangeTypeSchema = z.enum([
  "price_down",
  "price_up",
  "new_model",
  "removed",
  "restored",
  "context_change",
]);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const ChangeFieldSchema = z.object({
  field: z.enum(["input", "output", "cacheRead", "cacheWrite", "contextWindow"]),
  old: z.number().nullable(),
  new: z.number().nullable(),
  /** (new-old)/old；旧值为 0 或 null 时为 null */
  pct: z.number().nullable(),
});
export type ChangeField = z.infer<typeof ChangeFieldSchema>;

export const ChangeEventSchema = z.object({
  /** <YYYY-MM-DD>-<offeringId>-<序号> */
  id: z.string(),
  type: ChangeTypeSchema,
  offeringId: z.string(),
  vendor: IdSchema,
  modelSlug: z.string(),
  displayName: z.string(),
  platform: IdSchema,
  currency: CurrencySchema,
  fields: z.array(ChangeFieldSchema),
  confirmedFromQuarantine: z.boolean(),
  detectedAt: IsoDateTimeSchema,
});
export type ChangeEvent = z.infer<typeof ChangeEventSchema>;

/** data/changes/<YYYY-MM>.json */
export const ChangesMonthFileSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  events: z.array(ChangeEventSchema),
});
export type ChangesMonthFile = z.infer<typeof ChangesMonthFileSchema>;

export const QuarantineEntrySchema = z.object({
  offeringId: z.string(),
  /** 与已发布值相比变化的字段 */
  fields: z.array(ChangeFieldSchema),
  /** 候选的新价格（原币种） */
  candidate: PriceSetSchema,
  firstSeenAt: IsoDateTimeSchema,
  lastSeenAt: IsoDateTimeSchema,
  /** 连续抓到同一候选值的次数 */
  confirmations: z.number().int().positive(),
});
export type QuarantineEntry = z.infer<typeof QuarantineEntrySchema>;

/** data/quarantine.json */
export const QuarantineFileSchema = z.object({
  entries: z.array(QuarantineEntrySchema),
});
export type QuarantineFile = z.infer<typeof QuarantineFileSchema>;

export const FxProviderSchema = z.enum(["frankfurter", "er-api", "previous", "fallback"]);
export type FxProvider = z.infer<typeof FxProviderSchema>;

export const FxRateSchema = z.object({
  date: IsoDateSchema,
  usdCny: z.number().positive(),
  provider: FxProviderSchema,
});
export type FxRate = z.infer<typeof FxRateSchema>;

/** data/fx.json：history 保留最近 90 天 */
export const FxFileSchema = z.object({
  latest: FxRateSchema,
  lastSuccessAt: IsoDateTimeSchema.nullable(),
  history: z.array(FxRateSchema),
});
export type FxFile = z.infer<typeof FxFileSchema>;

export const SourceResultStatusSchema = z.enum(["ok", "failed", "rejected"]);

export const SourceResultSchema = z.object({
  id: IdSchema,
  kind: SourceKindSchema,
  status: SourceResultStatusSchema,
  offeringCount: z.number().int().nonnegative(),
  /** 视频/图像报价条数（1.1.0 新增；只有提供视频/图像的源才有） */
  mediaOfferingCount: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  lastSuccessAt: IsoDateTimeSchema.nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
});
export type SourceResult = z.infer<typeof SourceResultSchema>;

export const RunSummarySchema = z.object({
  id: z.string(),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
  durationMs: z.number().int().nonnegative(),
  result: z.enum(["success", "partial", "failed"]),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const WarningSchema = z.object({
  code: z.string().regex(/^[EW]\d{4}$/),
  sourceId: z.string().nullable(),
  offeringId: z.string().nullable(),
  message: z.string(),
});
export type Warning = z.infer<typeof WarningSchema>;

/** data/status.json */
export const StatusFileSchema = z.object({
  run: RunSummarySchema,
  sources: z.array(SourceResultSchema),
  quarantine: z.array(QuarantineEntrySchema),
  warnings: z.array(WarningSchema),
});
export type StatusFile = z.infer<typeof StatusFileSchema>;

// ───────────────────────── 配置文件 ─────────────────────────

export const VendorConfigSchema = z.object({
  id: IdSchema,
  nameZh: z.string(),
  nameEn: z.string(),
  region: RegionSchema,
  website: z.url(),
  /** 官方定价页，作为聚合源（LiteLLM）报价的证据链接 */
  pricingUrl: z.url({ protocol: /^https$/ }).nullable(),
  logo: z.string().nullable(),
  /** vendorHint 匹配关键字（不区分大小写，完全相等或作为前缀 "xxx/"） */
  matchers: z.array(z.string()).min(1),
  allowedSourceDomains: z.array(z.string()),
});
export type VendorConfig = z.infer<typeof VendorConfigSchema>;

export const PlatformCategorySchema = z.enum(["official", "aggregator", "cloud", "inference"]);
export type PlatformCategory = z.infer<typeof PlatformCategorySchema>;

export const PlatformConfigSchema = z.object({
  id: IdSchema,
  nameZh: z.string(),
  nameEn: z.string(),
  website: z.url().nullable(),
  allowedSourceDomains: z.array(z.string()),
  /** official 官方 / aggregator 聚合平台 / cloud 云平台 / inference 推理服务商；缺省按 official 处理 */
  category: PlatformCategorySchema.optional(),
  /** 平台定价页，作为转售报价的证据链接 */
  pricingUrl: z
    .url({ protocol: /^https$/ })
    .nullable()
    .optional(),
  /** 转售数据源用来识别平台的名称：LiteLLM 的 litellm_provider、OpenRouter 的 provider_name（不区分大小写） */
  matchers: z.array(z.string()).optional(),
});
export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

export const ProvidersConfigSchema = z.object({
  vendors: z.array(VendorConfigSchema),
  platforms: z.array(PlatformConfigSchema),
});
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

/** config/aliases.yaml：规范 slug → 别名列表 */
export const AliasesConfigSchema = z.record(z.string(), z.array(z.string()));
export type AliasesConfig = z.infer<typeof AliasesConfigSchema>;

export const OverrideSchema = z.object({
  offering: z.string(),
  action: z.enum(["approve", "block", "pin"]),
  until: IsoDateSchema,
  reason: z.string().min(1),
  /** action = pin 时必填 */
  price: PriceSetSchema.partial().optional(),
});
export type Override = z.infer<typeof OverrideSchema>;
export const OverridesConfigSchema = z.array(OverrideSchema);

export const ManualSourceConfigSchema = z.object({
  source: IdSchema,
  platform: IdSchema,
  vendor: z.string(),
  currency: CurrencySchema,
  unit: RawUnitSchema,
  sourceUrl: z.url({ protocol: /^https$/ }),
  verifiedAt: IsoDateSchema,
  models: z.array(
    z.object({
      model: z.string(),
      displayName: z.string().optional(),
      input: PriceSchema,
      output: PriceSchema,
      cacheRead: PriceSchema.optional(),
      cacheWrite: PriceSchema.optional(),
      contextWindow: z.number().int().positive().nullable().optional(),
      maxOutput: z.number().int().positive().nullable().optional(),
      notes: z.string().optional(),
      /** 阶梯价（按单次输入长度分档），单位与文件的 unit 相同 */
      tiers: z.array(RawTierSchema).optional(),
    }),
  ),
});
export type ManualSourceConfig = z.infer<typeof ManualSourceConfigSchema>;

// ───────────────────────── 编程套餐（Coding Plan，1.3） ─────────────────────────

/**
 * 额度类型：
 * - credits：含固定美元额度（GitHub Copilot、Claude Max 的 API 额度），可直接算「额度价值」
 * - points：积分 / 请求次数等有公开数字的限额（智谱 GLM 的 5 小时 / 每周积分）
 * - relative：只写了「Pro 的 N 倍」这类相对说法
 * - unpublished：官方未公开具体额度
 */
export const PlanQuotaKindSchema = z.enum(["credits", "points", "relative", "unpublished"]);
export type PlanQuotaKind = z.infer<typeof PlanQuotaKindSchema>;

export const PlanSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(60),
  /** 按月付的月费（文件的 currency） */
  monthly: z.number().positive(),
  /** 按年付折算的月均价；没有年付时省略 */
  annualMonthly: z.number().positive().optional(),
  quotaKind: PlanQuotaKindSchema,
  quotaZh: z.string().min(1).max(200),
  quotaEn: z.string().min(1).max(200),
  /** 每月包含的美元额度（credits 类型必填） */
  creditsUsd: z.number().positive().optional(),
  notesZh: z.string().max(200).optional(),
  notesEn: z.string().max(200).optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

/** config/plans/<provider>.yaml：一个提供方的全部套餐 */
export const PlanFileSchema = z
  .object({
    provider: z.object({
      id: IdSchema,
      nameZh: z.string(),
      nameEn: z.string(),
      region: RegionSchema,
    }),
    currency: CurrencySchema,
    sourceUrl: z.url({ protocol: /^https$/ }),
    verifiedAt: IsoDateSchema,
    /** 适用的工具 / 使用范围 */
    toolsZh: z.string().max(200),
    toolsEn: z.string().max(200),
    /** 用来折算「按量付费一次要多少钱」的模型（vendor/model，取其官方价） */
    breakEvenModel: z.string().regex(/^[a-z0-9.-]+\/[a-z0-9.-]+$/),
    plans: z.array(PlanSchema).min(1),
  })
  .refine(
    (file) => file.plans.every((p) => p.quotaKind !== "credits" || p.creditsUsd !== undefined),
    { message: "quotaKind = credits 的套餐必须填写 creditsUsd" },
  );
export type PlanFile = z.infer<typeof PlanFileSchema>;
