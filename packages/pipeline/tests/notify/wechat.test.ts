import type { ChangeEvent } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { isPipelineError, PipelineError } from "../../src/core/errors";
import type { DailyReport } from "../../src/notify/types";
import { createNotifiers } from "../../src/notify/index";
import { createWechatNotifier, fetchSiteCover } from "../../src/notify/wechat";
import type { DraftArticle, WechatApi } from "../../src/notify/wechat-api";
import type { ArticleContext } from "../../src/notify/wechat-article";
import { createFakeHttp, makeConfig, NOW, NOW_ISO } from "../helpers";

const ctx: ArticleContext = {
  vendorName: (id) => id,
  platformName: (id) => id,
  priceOf: () => null,
};

function report(changes: readonly ChangeEvent[]): DailyReport {
  return {
    date: "2026-10-31",
    run: { id: "1", startedAt: NOW_ISO, finishedAt: NOW_ISO, durationMs: 1, result: "success" },
    sources: [],
    changes,
    quarantined: [],
    errors: [],
    siteUrl: "https://example.com/board",
  };
}

const drop: ChangeEvent = {
  id: "2026-10-31-official:deepseek/deepseek-chat-1",
  type: "price_down",
  offeringId: "official:deepseek/deepseek-chat",
  vendor: "deepseek",
  modelSlug: "deepseek/deepseek-chat",
  displayName: "DeepSeek V3",
  platform: "official",
  currency: "CNY",
  fields: [{ field: "output", old: 8, new: 4, pct: -0.5 }],
  confirmedFromQuarantine: false,
  detectedAt: NOW_ISO,
};

function fakeApi(fail?: PipelineError) {
  const drafts: DraftArticle[] = [];
  const uploads: string[] = [];
  const api: WechatApi = {
    getAccessToken: async () => "T",
    uploadImage: async (_image, filename) => {
      uploads.push(filename);
      return "UPLOADED-THUMB";
    },
    addDraft: async (article) => {
      if (fail) throw fail;
      drafts.push(article);
      return "DRAFT-1";
    },
  };
  return { api, drafts, uploads };
}

const config = { appId: "wx", appSecret: "s", thumbMediaId: null, author: "AI序言" };

describe("公众号推送渠道（只存草稿）", () => {
  it("只在配置了公众号时启用", () => {
    const { api } = fakeApi();
    const notifier = createWechatNotifier({
      config,
      api,
      loadContext: async () => ctx,
      fetchCover: async () => new Uint8Array([1]),
    });
    expect(notifier.id).toBe("wechat");
    expect(notifier.isConfigured(makeConfig())).toBe(false);
    expect(notifier.isConfigured(makeConfig({ wechat: config }))).toBe(true);
  });

  it("有变动时新建草稿；没配封面 media_id 时上传网站分享图并回调告知", async () => {
    const { api, drafts, uploads } = fakeApi();
    const uploaded: string[] = [];
    const notifier = createWechatNotifier({
      config,
      api,
      loadContext: async () => ctx,
      fetchCover: async () => new Uint8Array([1, 2]),
      onCoverUploaded: (id) => uploaded.push(id),
      onDraftCreated: () => undefined,
    });
    await notifier.send(report([drop]));
    expect(uploads).toEqual(["cover.png"]);
    expect(uploaded).toEqual(["UPLOADED-THUMB"]);
    expect(drafts).toEqual([
      expect.objectContaining({
        title: "AI 价格日报 10/31｜DeepSeek V3 降价 50%",
        author: "AI序言",
        thumbMediaId: "UPLOADED-THUMB",
        contentSourceUrl: "https://example.com/board/changes",
      }),
    ]);
  });

  it("配置了封面 media_id 时不再上传", async () => {
    const { api, drafts, uploads } = fakeApi();
    const notifier = createWechatNotifier({
      config: { ...config, thumbMediaId: "FIXED" },
      api,
      loadContext: async () => ctx,
      fetchCover: async () => {
        throw new Error("不应下载封面");
      },
    });
    await notifier.send(report([drop]));
    expect(uploads).toEqual([]);
    expect(drafts[0]?.thumbMediaId).toBe("FIXED");
  });

  it("没有值得发的变动时什么都不做", async () => {
    const { api, drafts, uploads } = fakeApi();
    const notifier = createWechatNotifier({
      config,
      api,
      loadContext: async () => ctx,
      fetchCover: async () => new Uint8Array([1]),
    });
    await notifier.send(report([{ ...drop, type: "context_change" }]));
    expect(drafts).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it("接口失败时抛 E5001", async () => {
    const { api } = fakeApi(
      new PipelineError("E5001", "公众号接口失败（新建草稿）：errcode=48001"),
    );
    const notifier = createWechatNotifier({
      config: { ...config, thumbMediaId: "FIXED" },
      api,
      loadContext: async () => ctx,
      fetchCover: async () => new Uint8Array([1]),
    });
    const error = await notifier.send(report([drop])).catch((e: unknown) => e);
    expect(isPipelineError(error) && error.code).toBe("E5001");
  });

  it("封面取网站分享图 og/site.png；下载失败抛 E5001", async () => {
    const urls: string[] = [];
    const ok = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 });
    }) as typeof fetch;
    expect((await fetchSiteCover("https://example.com/board", ok)).length).toBe(4);
    expect(urls).toEqual(["https://example.com/board/og/site.png"]);
    const notFound = (async () => new Response("", { status: 404 })) as typeof fetch;
    const error = await fetchSiteCover("https://example.com/board", notFound).catch(
      (e: unknown) => e,
    );
    expect(isPipelineError(error) && error.code).toBe("E5001");
  });

  it("createNotifiers：配置了公众号且提供了文章上下文才启用", () => {
    const deps = { http: createFakeHttp({}), now: () => NOW };
    const withWechat = makeConfig({ wechat: config });
    expect(createNotifiers(withWechat, deps).map((n) => n.id)).toEqual([]);
    expect(
      createNotifiers(withWechat, { ...deps, wechatContext: async () => ctx }).map((n) => n.id),
    ).toEqual(["wechat"]);
  });
});
