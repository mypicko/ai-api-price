import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "../../src/core/logger";
import { collectManualOfferings, manualCnSource, manualSource } from "../../src/sources/manual";
import { createFakeHttp, noopBrowser, NOW } from "../helpers";

let root: string;
const ctx = () => ({
  http: createFakeHttp({}),
  browser: noopBrowser,
  logger: silentLogger,
  now: NOW,
  rootDir: root,
});

const YAML = `source: manual-volcengine
platform: official
vendor: bytedance
currency: CNY
unit: per_1m
sourceUrl: https://www.volcengine.com/docs/82379/1544106
verifiedAt: 2026-10-18
models:
  - model: doubao-pro-32k
    displayName: 豆包 Pro 32K
    input: 0.8
    output: 2.0
    cacheRead: 0.16
    contextWindow: 32000
    notes: 人工核对
  - model: doubao-lite
    input: 0.3
    output: 0.6
`;

const CN_YAML = `source: manual-qianfan
platform: official-cn
vendor: baidu
currency: CNY
unit: per_1k
sourceUrl: https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya
verifiedAt: 2026-10-19
models:
  - model: ernie-5.1
    input: 0.004
    output: 0.018
    tiers:
      - { minInputTokens: 0, maxInputTokens: 32000, input: 0.004, output: 0.018 }
      - { minInputTokens: 32000, maxInputTokens: 128000, input: 0.006, output: 0.022 }
`;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "aipb-manual-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("source/manual", () => {
  it("目录不存在或为空时返回空数组（算成功）", async () => {
    await expect(manualSource.fetch(ctx())).resolves.toEqual([]);
    await mkdir(path.join(root, "config/manual"), { recursive: true });
    await writeFile(path.join(root, "config/manual/README.md"), "# 说明");
    await expect(manualSource.fetch(ctx())).resolves.toEqual([]);
  });

  it("把 yaml 转成 RawOffering", async () => {
    await mkdir(path.join(root, "config/manual"), { recursive: true });
    await writeFile(path.join(root, "config/manual/volcengine.yaml"), YAML);
    const offerings = await manualSource.fetch(ctx());
    expect(offerings).toHaveLength(2);
    expect(offerings[0]).toEqual({
      vendorHint: "bytedance",
      modelName: "doubao-pro-32k",
      displayName: "豆包 Pro 32K",
      currency: "CNY",
      unit: "per_1m",
      input: 0.8,
      output: 2,
      cacheRead: 0.16,
      contextWindow: 32000,
      maxOutput: null,
      sourceUrl: "https://www.volcengine.com/docs/82379/1544106",
      notes: "人工核对",
    });
    expect(offerings[1]).not.toHaveProperty("displayName");
  });

  it("文件格式错误时抛 E3001", async () => {
    await mkdir(path.join(root, "config/manual"), { recursive: true });
    await writeFile(path.join(root, "config/manual/bad.yaml"), "source: 1\n");
    await expect(manualSource.fetch(ctx())).rejects.toMatchObject({ code: "E3001" });
  });

  it("按平台分流：official 文件只进 manual，official-cn 文件只进 manual-cn", async () => {
    await mkdir(path.join(root, "config/manual"), { recursive: true });
    await writeFile(path.join(root, "config/manual/volcengine.yaml"), YAML);
    await writeFile(path.join(root, "config/manual/kimi-cn.yaml"), CN_YAML);
    const official = await manualSource.fetch(ctx());
    const cn = await manualCnSource.fetch(ctx());
    expect(official.map((o) => o.modelName)).toEqual(["doubao-pro-32k", "doubao-lite"]);
    expect(cn.map((o) => o.modelName)).toEqual(["ernie-5.1"]);
    expect(manualCnSource).toMatchObject({ id: "manual-cn", platform: "official-cn" });
  });

  it("阶梯价原样传给 RawOffering", async () => {
    await mkdir(path.join(root, "config/manual"), { recursive: true });
    await writeFile(path.join(root, "config/manual/kimi-cn.yaml"), CN_YAML);
    const [ernie] = await manualCnSource.fetch(ctx());
    expect(ernie).toMatchObject({
      unit: "per_1k",
      input: 0.004,
      output: 0.018,
      tiers: [
        { minInputTokens: 0, maxInputTokens: 32000, input: 0.004, output: 0.018 },
        { minInputTokens: 32000, maxInputTokens: 128000, input: 0.006, output: 0.022 },
      ],
    });
  });

  it("非 official 平台的文件跳过", () => {
    const file = {
      file: "sf.yaml",
      config: {
        source: "manual-sf",
        platform: "siliconflow",
        vendor: "deepseek",
        currency: "CNY" as const,
        unit: "per_1m" as const,
        sourceUrl: "https://siliconflow.cn/pricing",
        verifiedAt: "2026-10-18",
        models: [{ model: "x", input: 1, output: 2 }],
      },
    };
    expect(collectManualOfferings([file], silentLogger)).toEqual([]);
  });
});
