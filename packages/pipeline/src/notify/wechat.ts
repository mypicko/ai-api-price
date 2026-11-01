/**
 * 公众号推送渠道（DEV_DOCUMENT §3.24）：只新建草稿，由人在「公众号助手」里确认后手动群发
 * （个人主体未认证订阅号没有群发接口权限）。
 * - 当天没有值得发的变动时什么都不做
 * - 封面优先用 WECHAT_THUMB_MEDIA_ID；没填时下载网站分享图上传为永久素材，并通过回调提示保存 media_id
 */
import type { WechatConfig } from "../config";
import { PipelineError } from "../core/errors";
import type { DailyReport, Notifier } from "./types";
import type { WechatApi } from "./wechat-api";
import { buildWechatArticle, type ArticleContext } from "./wechat-article";

export interface WechatNotifierDeps {
  readonly config: WechatConfig;
  readonly api: WechatApi;
  readonly loadContext: () => Promise<ArticleContext>;
  /** 下载封面图（PNG） */
  readonly fetchCover: () => Promise<Uint8Array<ArrayBuffer>>;
  readonly onCoverUploaded?: (mediaId: string) => void;
  readonly onDraftCreated?: (title: string, mediaId: string) => void;
}

export function createWechatNotifier(deps: WechatNotifierDeps): Notifier {
  async function thumbMediaId(): Promise<string> {
    if (deps.config.thumbMediaId) return deps.config.thumbMediaId;
    const id = await deps.api.uploadImage(await deps.fetchCover(), "cover.png");
    deps.onCoverUploaded?.(id);
    return id;
  }

  return {
    id: "wechat",
    isConfigured: (config) => config.wechat !== null,
    async send(report: DailyReport) {
      const article = buildWechatArticle(report, await deps.loadContext());
      if (!article) return;
      const draftId = await deps.api.addDraft({
        title: article.title,
        author: deps.config.author,
        digest: article.digest,
        content: article.html,
        contentSourceUrl: article.contentSourceUrl,
        thumbMediaId: await thumbMediaId(),
      });
      deps.onDraftCreated?.(article.title, draftId);
    },
  };
}

/** 网站的分享图（1200×630 PNG），作为公众号封面 */
export async function fetchSiteCover(
  siteUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array<ArrayBuffer>> {
  const url = `${siteUrl}/og/site.png`;
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new PipelineError("E5001", `公众号：下载封面失败（${url}）`, { cause: error });
  }
  if (!response.ok)
    throw new PipelineError("E5001", `公众号：下载封面失败（HTTP ${response.status}，${url}）`);
  return new Uint8Array(await response.arrayBuffer());
}
