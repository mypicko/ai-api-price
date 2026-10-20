# 编程套餐（Coding Plan）

每个提供方一个 `<provider>.yaml`，格式见 `packages/shared/src/schema.ts` 的 `PlanFileSchema`。
价格页大多只能人工核对（额度规则、限时折扣变化快），`verifiedAt` 写最后核对日期，建议每两周复核一次。

- `breakEvenModel`：用来折算「按量付费一次要多少钱」的模型，取其官方价
- `quotaKind`：credits（含美元额度）/ points（有公开数字的积分或次数）/ relative（「Pro 的 N 倍」）/ unpublished（官方未公开）
- 没有公开具体额度的，如实写「官方未公开具体额度」，不要估算
