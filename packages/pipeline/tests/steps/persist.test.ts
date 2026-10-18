import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { QuarantineFileSchema } from "@aipb/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { persistFiles, serializeJson } from "../../src/steps/persist";
import {
  loadChangesMonth,
  loadHistoryFiles,
  loadPreviousState,
  readJsonFile,
} from "../../src/steps/state";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "aipb-persist-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exists = async (file: string): Promise<boolean> =>
  stat(file).then(
    () => true,
    () => false,
  );

describe("persist", () => {
  it("写入嵌套路径，2 空格缩进 + 末尾换行，键顺序按 schema", async () => {
    const schema = z.object({ b: z.number(), a: z.string() });
    const written = await persistFiles(dir, [
      { path: "history/openai/gpt-4o.json", schema, content: { a: "x", b: 1, extra: true } },
      { path: "fx.json", schema, content: { a: "y", b: 2 } },
    ]);
    expect(written).toEqual(["fx.json", "history/openai/gpt-4o.json"]);
    const text = await readFile(path.join(dir, "history/openai/gpt-4o.json"), "utf8");
    expect(text).toBe('{\n  "b": 1,\n  "a": "x"\n}\n');
    expect(await exists(path.join(dir, ".tmp"))).toBe(false);
  });

  it("校验失败时抛 E4001，已有文件不受影响，临时目录被清理", async () => {
    await writeFile(path.join(dir, "quarantine.json"), serializeJson({ entries: [] }));
    const files = [
      { path: "quarantine.json", schema: QuarantineFileSchema, content: { entries: [] } },
      { path: "status.json", schema: z.object({ ok: z.literal(true) }), content: { ok: false } },
    ];
    await expect(persistFiles(dir, files)).rejects.toMatchObject({ code: "E4001" });
    expect(await readFile(path.join(dir, "quarantine.json"), "utf8")).toBe(
      '{\n  "entries": []\n}\n',
    );
    expect(await exists(path.join(dir, "status.json"))).toBe(false);
    expect(await exists(path.join(dir, ".tmp"))).toBe(false);
  });

  it("拒绝越界路径", async () => {
    await expect(
      persistFiles(dir, [{ path: "../evil.json", schema: z.unknown(), content: 1 }]),
    ).rejects.toMatchObject({ code: "E4001" });
    await expect(
      persistFiles(dir, [{ path: "/abs.json", schema: z.unknown(), content: 1 }]),
    ).rejects.toMatchObject({ code: "E4001" });
  });

  it("文件系统错误包装成 E4001", async () => {
    await writeFile(path.join(dir, "blocker"), "x");
    await expect(
      persistFiles(path.join(dir, "blocker"), [
        { path: "a.json", schema: z.unknown(), content: 1 },
      ]),
    ).rejects.toMatchObject({
      code: "E4001",
    });
  });
});

describe("state", () => {
  it("文件不存在视为第一次运行", async () => {
    await expect(loadPreviousState(dir)).resolves.toEqual({
      latest: null,
      quarantine: [],
      fx: null,
      status: null,
    });
    await expect(loadChangesMonth(dir, "2026-10")).resolves.toBeNull();
    await expect(loadHistoryFiles(dir, ["openai/gpt-4o"])).resolves.toEqual(new Map());
  });

  it("读取 history 文件", async () => {
    await mkdir(path.join(dir, "history/openai"), { recursive: true });
    await writeFile(
      path.join(dir, "history/openai/gpt-4o.json"),
      serializeJson({ modelSlug: "openai/gpt-4o", series: {} }),
    );
    const files = await loadHistoryFiles(dir, ["openai/gpt-4o", "openai/gpt-4o", "openai/other"]);
    expect([...files.keys()]).toEqual(["openai/gpt-4o"]);
  });

  it("文件不合法时抛 E4001，避免用坏数据覆盖历史", async () => {
    await writeFile(path.join(dir, "latest.json"), "{ not json");
    await expect(loadPreviousState(dir)).rejects.toMatchObject({ code: "E4001" });
    await writeFile(path.join(dir, "latest.json"), '{"offerings": 1}');
    await expect(loadPreviousState(dir)).rejects.toThrow(/schema/);
    await mkdir(path.join(dir, "fx.json"));
    await expect(readJsonFile(path.join(dir, "fx.json"), z.unknown())).rejects.toMatchObject({
      code: "E4001",
    });
  });
});
