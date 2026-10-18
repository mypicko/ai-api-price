import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadAliases,
  loadConfigFiles,
  loadManualConfigs,
  loadOverrides,
  loadProviders,
} from "../src/config-files";
import { ROOT_DIR } from "./helpers";

let root: string;

async function writeConfig(name: string, content: string): Promise<void> {
  const file = path.join(root, "config", name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

const PROVIDERS = `vendors:
  - { id: openai, nameZh: OpenAI, nameEn: OpenAI, region: intl, website: "https://openai.com", pricingUrl: null, logo: null, matchers: [openai], allowedSourceDomains: [openai.com] }
platforms:
  - { id: official, nameZh: 官方, nameEn: Official, website: null, allowedSourceDomains: [] }
`;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "aipb-config-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("config-files", () => {
  it("能读取仓库里真实的配置文件", async () => {
    const files = await loadConfigFiles(ROOT_DIR);
    expect(files.providers.vendors.length).toBeGreaterThan(10);
    expect(files.providers.platforms.map((p) => p.id)).toContain("openrouter");
    expect(typeof files.aliases).toBe("object");
    expect(Array.isArray(files.overrides)).toBe(true);
  });

  it("providers.yaml 缺失或格式错误时抛 E3001", async () => {
    await expect(loadProviders(root)).rejects.toMatchObject({ code: "E3001" });
    await writeConfig("providers.yaml", "vendors: [ { id: 1 } ]\nplatforms: []\n");
    await expect(loadProviders(root)).rejects.toMatchObject({ code: "E3001" });
    await writeConfig("providers.yaml", "vendors: [\n");
    await expect(loadProviders(root)).rejects.toThrow(/YAML/);
  });

  it("providers.yaml 有重复 id 时报错", async () => {
    const dup = PROVIDERS.replace(
      "platforms:",
      `  - ${PROVIDERS.split("\n")[1]?.trim().slice(2)}\nplatforms:`,
    );
    await writeConfig("providers.yaml", dup);
    await expect(loadProviders(root)).rejects.toThrow(/重复/);
  });

  it("aliases / overrides 文件缺失或为空时返回默认值", async () => {
    await expect(loadAliases(root)).resolves.toEqual({});
    await writeConfig("overrides.yaml", "# 只有注释\n");
    await expect(loadOverrides(root)).resolves.toEqual([]);
  });

  it("overrides 的 pin 必须带 price", async () => {
    await writeConfig(
      "overrides.yaml",
      '- { offering: "official:a/b", action: pin, until: 2026-11-01, reason: "x" }\n',
    );
    await expect(loadOverrides(root)).rejects.toThrow(/price/);
    await writeConfig(
      "overrides.yaml",
      '- { offering: "official:a/b", action: approve, until: 2026-11-01, reason: "x" }\n',
    );
    await expect(loadOverrides(root)).resolves.toHaveLength(1);
  });

  it("manual 目录不存在时返回空数组；读取 yaml 并按文件名排序", async () => {
    await expect(loadManualConfigs(root)).resolves.toEqual([]);
    const yaml = (vendor: string) =>
      `source: manual-${vendor}\nplatform: official\nvendor: ${vendor}\ncurrency: CNY\nunit: per_1m\nsourceUrl: https://www.volcengine.com/docs\nverifiedAt: 2026-10-18\nmodels:\n  - { model: m1, input: 0.8, output: 2 }\n`;
    await writeConfig("manual/b.yaml", yaml("bytedance"));
    await writeConfig("manual/a.yml", yaml("baidu"));
    await writeConfig("manual/README.md", "# 说明");
    const files = await loadManualConfigs(root);
    expect(files.map((f) => f.file)).toEqual(["a.yml", "b.yaml"]);
    expect(files[0]?.config.models[0]).toMatchObject({ model: "m1", input: 0.8 });
  });

  it("manual 文件格式错误时抛 E3001", async () => {
    await writeConfig("manual/bad.yaml", "source: x\n");
    await expect(loadManualConfigs(root)).rejects.toMatchObject({ code: "E3001" });
  });
});
