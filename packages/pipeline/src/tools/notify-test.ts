/**
 * `pnpm pipeline notify:test`：给所有已配置的渠道发一条测试消息。
 */
import type { ChangeEvent } from "@aipb/shared";
import type { Logger } from "../core/logger";
import { sendReport, type Notifier, type SendResult } from "../notify";
import type { DailyReport } from "../notify/types";
import { shanghaiDate, toIsoSeconds } from "../steps/dates";

export function buildTestReport(now: Date, siteUrl: string): DailyReport {
  const iso = toIsoSeconds(now);
  const today = shanghaiDate(now);
  const sample: ChangeEvent = {
    id: `${today}-official:example/test-model-1`,
    type: "price_down",
    offeringId: "official:example/test-model",
    vendor: "example",
    modelSlug: "example/test-model",
    displayName: "测试模型（这是一条测试消息）",
    platform: "official",
    currency: "CNY",
    fields: [{ field: "output", old: 8, new: 4, pct: -0.5 }],
    confirmedFromQuarantine: false,
    detectedAt: iso,
  };
  return {
    date: today,
    run: { id: "notify-test", startedAt: iso, finishedAt: iso, durationMs: 0, result: "success" },
    sources: [],
    changes: [sample],
    quarantined: [],
    errors: [],
    siteUrl,
  };
}

export async function runNotifyTest(
  notifiers: readonly Notifier[],
  now: Date,
  siteUrl: string,
  logger: Logger,
): Promise<SendResult> {
  return sendReport(notifiers, buildTestReport(now, siteUrl), logger);
}
