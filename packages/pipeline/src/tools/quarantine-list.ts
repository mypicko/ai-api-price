/**
 * `pnpm pipeline quarantine:list`：列出隔离区条目。
 */
import path from "node:path";
import { formatPct, QuarantineFileSchema, type QuarantineEntry } from "@aipb/shared";
import { readJsonFile } from "../steps/state";

export async function loadQuarantine(dataDir: string): Promise<readonly QuarantineEntry[]> {
  const file = await readJsonFile(path.join(dataDir, "quarantine.json"), QuarantineFileSchema);
  return file?.entries ?? [];
}

export function formatQuarantine(entries: readonly QuarantineEntry[]): string {
  if (entries.length === 0) return "隔离区为空\n";
  const lines = entries.map((e) => {
    const fields = e.fields
      .map((f) => `${f.field} ${f.old ?? "—"} → ${f.new ?? "—"}（${formatPct(f.pct)}）`)
      .join("，");
    return `- ${e.offeringId}：${fields}；确认 ${e.confirmations} 次，首次 ${e.firstSeenAt}，最近 ${e.lastSeenAt}`;
  });
  return `隔离区共 ${entries.length} 条：\n${lines.join("\n")}\n`;
}
