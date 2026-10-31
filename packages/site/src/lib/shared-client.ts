/**
 * 浏览器端可用的 shared 工具。
 * `@aipb/shared` 的入口会同时导出 schema.ts（依赖 zod，gzip 后约 60KB），
 * 交互组件只需要格式化和换算函数，所以走不含 zod 的子路径导出。
 */
export {
  currencySymbol,
  formatMediaPrice,
  formatPct,
  formatPrice,
  formatPriceNumber,
  formatTokens,
  mediaUnitSuffix,
} from "@aipb/shared/format";
export {
  blendedPrice,
  convertCurrency,
  convertPriceSet,
  lowOutlierFields,
  pctChange,
  roundSig,
} from "@aipb/shared/units";
