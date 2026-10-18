import { SCHEMA_VERSION } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import {
  changesIndexPayload,
  changesMonthPayload,
  changesPayload,
  fxPayload,
  jsonResponse,
  latestPayload,
  mediaChangesPayload,
  mediaPayload,
  modelPayload,
  providersPayload,
  statusPayload,
} from "../src/lib/api";
import { validateEnvelope } from "../src/lib/api-validate";
import { buildSiteModel, findModel } from "../src/lib/site-model";
import { fixtureData, fixtureModel } from "./helpers";

const model = fixtureModel();

describe("api", () => {
  it("latest.json：统一外层结构，过滤 removed，meta 带汇率", () => {
    const body = latestPayload(model);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.meta.count).toBe(body.data.offerings.length);
    expect(body.meta.fxRate?.provider).toBe("frankfurter");
    expect(body.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(body.data.offerings.some((o) => o.status === "removed")).toBe(false);
    expect(validateEnvelope("latest", JSON.parse(JSON.stringify(body)))).toEqual([]);
  });

  it("providers.json：modelCount 按去重模型计数", () => {
    const body = providersPayload(model);
    const deepseek = body.data.vendors.find((v) => v.id === "deepseek");
    expect(deepseek?.modelCount).toBe(2);
    expect(body.data.vendors.find((v) => v.id === "cohere")?.modelCount).toBe(0);
    expect(body.data.vendors.find((v) => v.id === "minimax")?.mediaModelCount).toBe(2);
    expect(body.data.vendors.find((v) => v.id === "openai")?.mediaModelCount).toBe(1); // sora-2 已下架
    expect(Object.keys(deepseek ?? {}).toSorted()).toEqual([
      "id",
      "logo",
      "mediaModelCount",
      "modelCount",
      "nameEn",
      "nameZh",
      "region",
      "website",
    ]);
    expect(body.data.platforms.map((p) => p.id).slice(0, 5)).toEqual([
      "official",
      "official-cn",
      "openrouter",
      "siliconflow",
      "siliconflow-cn",
    ]);
    expect(body.data.platforms.find((p) => p.id === "azure")?.category).toBe("cloud");
    expect(body.data.platforms.find((p) => p.id === "official")?.category).toBe("official");
    expect(body.meta.count).toBe(body.data.vendors.length);
    expect(validateEnvelope("providers", body)).toEqual([]);
  });

  it("models/{vendor}/{model}.json：包含历史和变动", () => {
    const info = findModel(model, "deepseek/deepseek-chat");
    if (!info) throw new Error("缺少模型");
    const body = modelPayload(model, info);
    expect(body.data.model.slug).toBe("deepseek/deepseek-chat");
    expect(Object.keys(body.data.history)).toHaveLength(3);
    expect(body.data.changes.every((c) => c.modelSlug === "deepseek/deepseek-chat")).toBe(true);
    expect(body.meta.count).toBeUndefined();
    expect(validateEnvelope("model", JSON.parse(JSON.stringify(body)))).toEqual([]);
    const removed = findModel(model, "cohere/command-r-plus");
    if (!removed) throw new Error("缺少已下架模型");
    const removedBody = modelPayload(model, removed);
    expect(removedBody.data.model.status).toBe("removed");
    expect(validateEnvelope("model", JSON.parse(JSON.stringify(removedBody)))).toEqual([]);
  });

  it("changes.json：最近 90 天，倒序", () => {
    const body = changesPayload(model);
    const times = body.data.events.map((e) => e.detectedAt);
    expect(times).toEqual(times.toSorted().toReversed());
    expect(body.meta.count).toBe(times.length);
    expect(validateEnvelope("changes", body)).toEqual([]);
    const later = buildSiteModel(fixtureData(), "2027-06-01T00:00:00Z");
    expect(changesPayload({ ...later, generatedAt: "2027-06-01T00:00:00Z" }).data.events).toEqual(
      [],
    );
  });

  it("changes/{month}.json 和 index.json", () => {
    expect(changesIndexPayload(model).data.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(validateEnvelope("changesIndex", changesIndexPayload(model))).toEqual([]);
    const october = changesMonthPayload(model, "2026-10");
    expect(october.data.events.every((e) => e.detectedAt.startsWith("2026-10"))).toBe(true);
    expect(changesMonthPayload(model, "2020-01").data.events).toEqual([]);
  });

  it("fx.json 和 status.json", () => {
    expect(fxPayload(model).meta.count).toBe(90);
    expect(validateEnvelope("fx", fxPayload(model))).toEqual([]);
    expect(validateEnvelope("status", statusPayload(model))).toEqual([]);
    const empty = buildSiteModel({ ...fixtureData(), status: null });
    expect(statusPayload(empty).data.run).toBeNull();
    expect(validateEnvelope("status", statusPayload(empty))).toEqual([]);
  });

  it("jsonResponse 输出 JSON 和正确的 Content-Type", async () => {
    const res = jsonResponse({ a: 1 });
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(JSON.parse(await res.text())).toEqual({ a: 1 });
  });
});

describe("api-validate", () => {
  it("发现结构错误", () => {
    expect(validateEnvelope("latest", null)).toEqual(["根节点不是对象"]);
    expect(validateEnvelope("latest", { success: false, error: "x", meta: {}, data: [] })).toEqual([
      "success 必须为 true",
      "error 必须为 null",
      "meta 缺少 schemaVersion / generatedAt / dataDate",
      "data 不是对象",
    ]);
    const body = JSON.parse(JSON.stringify(latestPayload(model)));
    body.meta.count = 1;
    body.data.offerings[0].status = "removed";
    body.data.offerings[1].converted = undefined;
    body.data.offerings[2].blended = { usd: "x" };
    body.data.offerings[3] = 5;
    const errors = validateEnvelope("latest", body);
    expect(errors.join("\n")).toMatch(/removed/);
    expect(errors.join("\n")).toMatch(/converted/);
    expect(errors.join("\n")).toMatch(/blended/);
    expect(errors.join("\n")).toMatch(/不是对象/);
    expect(errors.join("\n")).toMatch(/meta.count/);
  });

  it("发现各接口的数据错误", () => {
    const meta = { schemaVersion: "1", generatedAt: "x", dataDate: "y" };
    const wrap = (data: unknown) => ({ success: true, error: null, meta, data });
    expect(validateEnvelope("providers", wrap({ vendors: [{}], platforms: [1] }))).toHaveLength(2);
    expect(
      validateEnvelope("model", wrap({ model: null, offerings: [], changes: [], history: 1 })),
    ).toHaveLength(2);
    expect(
      validateEnvelope(
        "model",
        wrap({ model: { slug: "a" }, offerings: [], changes: [], history: { a: [{}] } }),
      ),
    ).toHaveLength(1);
    expect(validateEnvelope("changes", wrap({ events: "x" }))).toEqual(["data.events: 不是数组"]);
    expect(validateEnvelope("changesIndex", wrap({ months: ["2026-1"] }))).toHaveLength(1);
    expect(validateEnvelope("fx", wrap({ latest: {}, history: [] }))).toHaveLength(1);
    expect(
      validateEnvelope("status", wrap({ run: {}, sources: [], quarantine: [], warnings: [] })),
    ).toHaveLength(1);
  });

  it("media.json：视频/图像报价，过滤 removed，带换算价和档位", () => {
    const body = mediaPayload(model);
    expect(body.meta.count).toBe(body.data.offerings.length);
    expect(body.meta.fxRate?.usdCny).toBe(model.usdCny);
    const ids = body.data.offerings.map((o) => o.id);
    expect(ids).toContain("official:minimax/minimax-h3");
    expect(ids).not.toContain("official:openai/sora-2");
    const h3 = body.data.offerings.find((o) => o.id === "official:minimax/minimax-h3");
    expect(h3).toMatchObject({ kind: "video", unit: "per_second", output: 0.08, input: 0.04 });
    expect(h3?.converted.usd.tiers).toEqual(h3?.tiers);
    expect(h3?.converted.cny.output).toBeCloseTo(0.08 * model.usdCny, 5);
    expect(validateEnvelope("media", JSON.parse(JSON.stringify(body)))).toEqual([]);
  });

  it("media/changes.json：最近 90 天视频/图像变动，与文本变动分开", () => {
    const body = mediaChangesPayload(model);
    expect(body.data.events.length).toBeGreaterThan(0);
    expect(body.data.events.every((e) => !model.offeringsById.has(e.offeringId))).toBe(true);
    expect(changesPayload(model).data.events.some((e) => e.offeringId.includes("minimax-h3"))).toBe(
      false,
    );
    expect(validateEnvelope("mediaChanges", body)).toEqual([]);
  });

  it("media 校验：发现 removed 和多余字段", () => {
    const body = JSON.parse(JSON.stringify(mediaPayload(model))) as {
      data: { offerings: Record<string, unknown>[] };
    };
    const first = body.data.offerings[0] ?? {};
    body.data.offerings[0] = { ...first, status: "removed", extra: 1 };
    const errors = validateEnvelope("media", body);
    expect(errors.some((e) => e.includes("removed"))).toBe(true);
    expect(errors.length).toBeGreaterThan(1);
    body.data.offerings[0] = { ...first, converted: null };
    expect(validateEnvelope("media", body).some((e) => e.includes("converted"))).toBe(true);
  });
});
