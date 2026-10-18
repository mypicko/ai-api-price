import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/core/logger";
import { qianfanSource } from "../../src/sources/qianfan";
import { ALL_SOURCES } from "../../src/sources/registry";
import { createFakeHttp, noopBrowser, NOW, ROOT_DIR } from "../helpers";

describe("source/qianfan", () => {
  it("定价页境外不可达：未注册到 registry，直接调用时抛 E1001", async () => {
    expect(ALL_SOURCES.map((s) => s.id)).not.toContain("qianfan");
    const ctx = {
      http: createFakeHttp({}),
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    };
    await expect(qianfanSource.fetch(ctx)).rejects.toThrow(/E1001/);
  });
});
