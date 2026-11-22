/**
 * 国内 vs 海外价差接口 /api/v1/cn-vs-intl.json 的数据结构（DEV §3.32）。
 * 网站构建时生成，公众号专题文章（pipeline 的 wechat:topic cn-intl）从线上读取并用它校验。
 * 价格都已换算成人民币（每百万 tokens），价差 = (国内 − 海外) / 海外，负数 = 国内更便宜。
 */
import { z } from "zod";

const CnyPairSchema = z.object({
  input: z.number().nullable(),
  output: z.number().nullable(),
});

export const CnIntlItemSchema = z.object({
  modelSlug: z.string(),
  displayName: z.string(),
  vendor: z.string(),
  vendorName: z.string(),
  domestic: CnyPairSchema,
  openrouter: CnyPairSchema.nullable(),
  openrouterPct: z.number().nullable(),
  intl: CnyPairSchema.nullable(),
  intlPct: z.number().nullable(),
});
export type CnIntlItem = z.infer<typeof CnIntlItemSchema>;

export const CnIntlDataSchema = z.object({
  summary: z.object({
    total: z.number().int(),
    openrouter: z.object({ compared: z.number().int(), cheaper: z.number().int() }),
    intl: z.object({ compared: z.number().int(), cheaper: z.number().int() }),
  }),
  items: z.array(CnIntlItemSchema),
});
export type CnIntlData = z.infer<typeof CnIntlDataSchema>;

/** 外层与其它公开接口一致：{success, data, error, meta} */
export const CnIntlPayloadSchema = z.object({
  success: z.literal(true),
  data: CnIntlDataSchema,
  meta: z.object({ dataDate: z.string() }).passthrough(),
});
export type CnIntlPayload = z.infer<typeof CnIntlPayloadSchema>;
