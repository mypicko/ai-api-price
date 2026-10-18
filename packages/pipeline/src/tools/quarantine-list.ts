/**
 * `pnpm pipeline quarantine:list`：列出隔离区条目。
 */
import path from "node:path";
import { formatPct, QuarantineFileSchema, type QuarantineEntry } from "@aipb/shared";
import { readJsonFile } from "../steps/state";

/** subDir = "media" 时读取视频/图像隔离区 */
export async function loadQuarantine(
  dataDir: string,
  subDir = "",
): Promise<readonly QuarantineEntry[]> {
  const file = await readJsonFile(
    path.join(dataDir, subDir, "quarantine.json"),
    QuarantineFileSchema,
  );
  return file?.entries ?? [];
}

export function formatQuarantine(entries: readonly QuarantineEntry[], title = "隔离区"): string {
  if (entries.length === 0) return `${title}为空\n`;
  const lines = entries.map((e) => {
    const fields = e.fields
      .map((f) => `${f.field} ${f.old ?? "—"} → ${f.new ?? "—"}（${formatPct(f.pct)}）`)
      .join("，");
    return `- ${e.offeringId}：${fields}；确认 ${e.confirmations} 次，首次 ${e.firstSeenAt}，最近 ${e.lastSeenAt}`;
  });
  return `${title}共 ${entries.length} 条：\n${lines.join("\n")}\n`;
}
