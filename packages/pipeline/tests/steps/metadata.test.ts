import { describe, expect, it } from "vitest";
import { enrichMetadata, type ModelMetadata } from "../../src/steps/metadata";
import { makeOffering } from "../helpers";

const qwen = (overrides = {}) =>
  makeOffering({
    id: "official:alibaba/qwen-flash",
    vendor: "alibaba",
    model: "qwen-flash",
    modelSlug: "alibaba/qwen-flash",
    displayName: "qwen-flash",
    contextWindow: null,
    maxOutput: null,
    input: 0.02,
    output: 0.2,
    ...overrides,
  });

const META: readonly ModelMetadata[] = [
  {
    modelSlug: "alibaba/qwen-flash",
    displayName: "Qwen Flash",
    contextWindow: 1000000,
    maxOutput: 32768,
  },
];

describe("enrichMetadata", () => {
  it("只补空缺：原始 ID 名称换成友好名称，补上下文和最大输出，不改价格", () => {
    const [out] = enrichMetadata([qwen()], META, []);
    expect(out).toMatchObject({
      displayName: "Qwen Flash",
      contextWindow: 1000000,
      maxOutput: 32768,
      input: 0.02,
      output: 0.2,
    });
  });

  it("已有的友好名称和上下文不被覆盖", () => {
    const [out] = enrichMetadata(
      [qwen({ displayName: "通义千问 Flash", contextWindow: 128000 })],
      META,
      [],
    );
    expect(out).toMatchObject({
      displayName: "通义千问 Flash",
      contextWindow: 128000,
      maxOutput: 32768,
    });
  });

  it("没有元数据时沿用上一次已发布的名称和上下文，避免来回变动", () => {
    const previous = [
      qwen({ displayName: "Qwen Flash", contextWindow: 1000000, maxOutput: 32768 }),
    ];
    const [out] = enrichMetadata([qwen()], [], previous);
    expect(out).toMatchObject({
      displayName: "Qwen Flash",
      contextWindow: 1000000,
      maxOutput: 32768,
    });
  });

  it("上一次的名称也是原始 ID 时不沿用；没有任何信息时原样返回", () => {
    const original = qwen();
    const [out] = enrichMetadata([original], [], [qwen()]);
    expect(out).toBe(original);
  });

  it("元数据优先于沿用旧值", () => {
    const previous = [qwen({ displayName: "Old Name", contextWindow: 8000 })];
    const [out] = enrichMetadata([qwen()], META, previous);
    expect(out).toMatchObject({ displayName: "Qwen Flash", contextWindow: 1000000 });
  });
});

describe("enrichMetadata 快照", () => {
  it("带日期的快照借用基础模型名称并附上日期，但不借上下文", () => {
    const snapshot = qwen({
      id: "official:alibaba/qwen-flash-2025-07-28",
      model: "qwen-flash-2025-07-28",
      modelSlug: "alibaba/qwen-flash-2025-07-28",
      displayName: "qwen-flash-2025-07-28",
    });
    const [out] = enrichMetadata([snapshot], META, []);
    expect(out).toMatchObject({ displayName: "Qwen Flash (2025-07-28)", contextWindow: null });
  });

  it("基础模型也没有元数据时保持原样", () => {
    const snapshot = qwen({
      id: "official:alibaba/qwen-mt-2025-01-01",
      model: "qwen-mt-2025-01-01",
      modelSlug: "alibaba/qwen-mt-2025-01-01",
      displayName: "qwen-mt-2025-01-01",
    });
    const [out] = enrichMetadata([snapshot], META, []);
    expect(out).toBe(snapshot);
  });
});
