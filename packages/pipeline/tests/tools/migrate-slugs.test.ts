import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChangeEvent, HistoryFile, Offering } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { createAliasResolver } from "../../src/steps/normalize";
import {
  createIdMapper,
  migrateChanges,
  migrateDataDir,
  migrateHistory,
  migrateOfferings,
  migrateQuarantine,
} from "../../src/tools/migrate-slugs";

const mapId = createIdMapper(createAliasResolver({ "openai/gpt-3.5-turbo": ["gpt35"] }));

function offering(id: string, extra: Partial<Offering> = {}): Offering {
  const [platform = "", slug = ""] = id.split(":");
  const [vendor = "", model = ""] = slug.split("/");
  return {
    id,
    vendor,
    model,
    modelSlug: slug,
    displayName: model,
    platform,
    source: "litellm-resellers",
    currency: "USD",
    input: 1,
    output: 2,
    cacheRead: null,
    cacheWrite: null,
    tiers: null,
    contextWindow: null,
    maxOutput: null,
    modalities: ["text"],
    isFree: false,
    stale: false,
    status: "active",
    missingDays: 0,
    sourceUrl: "https://example.com",
    notes: null,
    firstSeenAt: "2026-10-19",
    fetchedAt: "2026-10-22T00:00:00Z",
    publishedAt: "2026-10-22T00:00:00Z",
    ...extra,
  } as Offering;
}

describe("migrateOfferings", () => {
  it("改名；同一平台撞名时保留在售、优先级高的一条，firstSeenAt 取较早", () => {
    const result = migrateOfferings(
      [
        offering("fireworks:alibaba/qwen2p5-72b-instruct", { firstSeenAt: "2026-10-18" }),
        offering("deepinfra:alibaba/qwen-2.5-72b-instruct", { source: "openrouter-endpoints" }),
        offering("deepinfra:alibaba/qwen2.5-72b-instruct", {
          source: "deepinfra",
          firstSeenAt: "2026-10-23",
        }),
        offering("deepinfra:meta/llama-v3p1-8b-instruct", {
          status: "missing",
          source: "deepinfra",
        }),
        offering("deepinfra:meta/llama-3.1-8b-instruct", { source: "litellm-resellers" }),
        offering("openai:openai/gpt-4o"),
      ],
      mapId,
    );
    expect(result.offerings.map((o) => o.id)).toEqual([
      "deepinfra:alibaba/qwen2.5-72b-instruct",
      "deepinfra:meta/llama-3.1-8b-instruct",
      "fireworks:alibaba/qwen2.5-72b-instruct",
      "openai:openai/gpt-4o",
    ]);
    const qwen = result.offerings[0];
    expect(qwen).toMatchObject({ source: "deepinfra", firstSeenAt: "2026-10-19" });
    expect(result.offerings[1]?.status).toBe("active");
    expect(result.offerings[2]).toMatchObject({
      model: "qwen2.5-72b-instruct",
      modelSlug: "alibaba/qwen2.5-72b-instruct",
    });
    expect(result.renamed).toBe(3);
    expect(result.merged).toBe(2);
    expect(result.keptFrom.get("deepinfra:alibaba/qwen2.5-72b-instruct")).toBe(
      "deepinfra:alibaba/qwen2.5-72b-instruct",
    );
  });

  it("同一来源撞名：保留原本就叫这个名字的，其次输入价低的（区域单列的贵价让位）", () => {
    const result = migrateOfferings(
      [
        offering("bedrock:alibaba/qwen.qwen3-next-80b-a3b", { input: 0.18 }),
        offering("bedrock:alibaba/qwen3-next-80b-a3b", { input: 0.15 }),
        offering("bedrock:deepseek/deepseek.v3.2", { input: 0.74 }),
        offering("bedrock:deepseek/v3.2", { input: 0.62 }),
      ],
      createIdMapper(createAliasResolver({ "deepseek/deepseek-v3.2": ["v3.2"] })),
    );
    expect(result.offerings.map((o) => [o.id, o.input])).toEqual([
      ["bedrock:alibaba/qwen3-next-80b-a3b", 0.15],
      ["bedrock:deepseek/deepseek-v3.2", 0.62],
    ]);
  });

  it("可重复执行：第二次没有改动", () => {
    const once = migrateOfferings([offering("fireworks:zhipu/glm-4p5")], mapId);
    const twice = migrateOfferings(once.offerings, mapId);
    expect(twice.renamed).toBe(0);
    expect(twice.offerings).toEqual(once.offerings);
  });
});

describe("migrateHistory", () => {
  const point = (input: number) => ({
    input,
    output: 2,
    cacheRead: null,
    cacheWrite: null,
    effectiveDate: "2026-10-19",
  });
  it("文件按新 slug 合并；撞名的序列以保留下来的那条为准", () => {
    const files: HistoryFile[] = [
      {
        modelSlug: "alibaba/qwen2.5-72b-instruct",
        series: { "deepinfra:alibaba/qwen2.5-72b-instruct": [point(1)] },
      },
      {
        modelSlug: "alibaba/qwen-2.5-72b-instruct",
        series: {
          "deepinfra:alibaba/qwen-2.5-72b-instruct": [point(2), point(3)],
          "together:alibaba/qwen-2.5-72b-instruct": [point(4)],
        },
      },
    ];
    const keptFrom = new Map([
      ["deepinfra:alibaba/qwen2.5-72b-instruct", "deepinfra:alibaba/qwen2.5-72b-instruct"],
    ]);
    expect(migrateHistory(files, mapId, keptFrom)).toEqual([
      {
        modelSlug: "alibaba/qwen2.5-72b-instruct",
        series: {
          "deepinfra:alibaba/qwen2.5-72b-instruct": [point(1)],
          "together:alibaba/qwen2.5-72b-instruct": [point(4)],
        },
      },
    ]);
  });
});

describe("migrateChanges / migrateQuarantine", () => {
  const event = (offeringId: string, n = 1): ChangeEvent => ({
    id: `2026-10-19-${offeringId}-${n}`,
    type: "new_model",
    offeringId,
    vendor: "openai",
    modelSlug: offeringId.split(":")[1] ?? "",
    displayName: "GPT-3.5",
    platform: "azure",
    currency: "USD",
    fields: [],
    confirmedFromQuarantine: false,
    detectedAt: "2026-10-19T08:00:00Z",
  });

  it("事件改名，改名后重复的事件只留一条", () => {
    const result = migrateChanges(
      {
        month: "2026-10",
        events: [event("azure:openai/gpt-35-turbo"), event("azure:openai/gpt-3.5-turbo")],
      },
      mapId,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "2026-10-19-azure:openai/gpt-3.5-turbo-1",
      offeringId: "azure:openai/gpt-3.5-turbo",
      modelSlug: "openai/gpt-3.5-turbo",
    });
  });

  it("隔离区条目改名", () => {
    const entry = {
      offeringId: "fireworks:zhipu/glm-4p5",
      fields: [],
      candidate: { input: 1, output: 2, cacheRead: null, cacheWrite: null },
      firstSeenAt: "2026-10-19T00:00:00Z",
      lastSeenAt: "2026-10-20T00:00:00Z",
      confirmations: 1,
    };
    expect(migrateQuarantine([entry], mapId)[0]?.offeringId).toBe("fireworks:zhipu/glm-4.5");
  });
});

describe("migrateDataDir", () => {
  it("写入合并后的文件并删除旧历史文件；dry-run 不改动", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aipb-migrate-"));
    const latest = {
      schemaVersion: "1.0.0",
      generatedAt: "2026-10-22T00:00:00Z",
      dataDate: "2026-10-22",
      offerings: [offering("fireworks:zhipu/glm-4p5"), offering("zhipu-official:zhipu/glm-4.5")],
    };
    await writeFile(path.join(dir, "latest.json"), JSON.stringify(latest));
    await mkdir(path.join(dir, "history/zhipu"), { recursive: true });
    const hist = (slug: string, id: string) =>
      JSON.stringify({ modelSlug: slug, series: { [id]: [] } });
    await writeFile(
      path.join(dir, "history/zhipu/glm-4p5.json"),
      hist("zhipu/glm-4p5", "fireworks:zhipu/glm-4p5"),
    );
    const resolve = createAliasResolver({});

    const dry = await migrateDataDir(dir, resolve, { dryRun: true });
    expect(dry.removed).toEqual(["history/zhipu/glm-4p5.json"]);
    expect(await readdir(path.join(dir, "history/zhipu"))).toEqual(["glm-4p5.json"]);

    await migrateDataDir(dir, resolve, { dryRun: false });
    expect(await readdir(path.join(dir, "history/zhipu"))).toEqual(["glm-4.5.json"]);
    const written = JSON.parse(
      await readFile(path.join(dir, "latest.json"), "utf8"),
    ) as typeof latest;
    expect(written.offerings.map((o) => o.id)).toEqual([
      "fireworks:zhipu/glm-4.5",
      "zhipu-official:zhipu/glm-4.5",
    ]);
  });
});
