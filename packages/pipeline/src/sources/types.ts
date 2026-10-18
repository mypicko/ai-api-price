/**
 * 抓取器契约（DEV_DOCUMENT §3.1、API 文档 §3.1）。
 * 抓取器只返回原始数据：不做单位换算、币种换算、slug 规范化，不写文件。
 * 失败时抛 PipelineError，不要返回空数组冒充成功。
 */
import type { RawMediaOffering, RawOffering, SourceKind } from "@aipb/shared";
import type { BrowserClient } from "../core/browser";
import type { HttpClient } from "../core/http";
import type { Logger } from "../core/logger";

export interface SourceContext {
  readonly http: HttpClient;
  readonly browser: BrowserClient;
  readonly logger: Logger;
  readonly now: Date;
  /** 仓库根目录（manual 源读取 config/manual/ 用） */
  readonly rootDir: string;
}

/** 抓取器的单条输出：文本 token 报价，或带 media 字段的视频/图像报价 */
export type SourceItem = RawOffering | RawMediaOffering;

export interface Source {
  /** 唯一 ID，例如 "deepseek"、"openrouter" */
  readonly id: string;
  /** 报价所属平台：official = 厂商直供 */
  readonly platform: string;
  readonly kind: SourceKind;
  /** 单次抓取总超时（毫秒） */
  readonly timeoutMs: number;
  fetch(ctx: SourceContext): Promise<readonly SourceItem[]>;
}
