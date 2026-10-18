import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  joinBase,
  localePath,
  modelPath,
  normalizeBase,
  pageHref,
  stripLocale,
} from "../src/lib/url";

describe("url", () => {
  it("规范化 base 路径", () => {
    expect(normalizeBase(undefined)).toBe("/");
    expect(normalizeBase("")).toBe("/");
    expect(normalizeBase("/")).toBe("/");
    expect(normalizeBase("ai-api-price")).toBe("/ai-api-price/");
    expect(normalizeBase("/ai-api-price/")).toBe("/ai-api-price/");
  });

  it("拼接 base 和路径", () => {
    expect(joinBase("/x/", "/models/a/b/")).toBe("/x/models/a/b/");
    expect(joinBase("/", "rss.xml")).toBe("/rss.xml");
  });

  it("中文无前缀，英文加 en/，页面路径以 / 结尾", () => {
    expect(localePath("zh")).toBe("/");
    expect(localePath("en")).toBe("/en/");
    expect(localePath("zh", "calculator")).toBe("/calculator/");
    expect(localePath("en", "/changes/")).toBe("/en/changes/");
    expect(localePath("en", "rss.xml")).toBe("/en/rss.xml");
    expect(pageHref("/x/", "en", modelPath("openai/gpt-5"))).toBe("/x/en/models/openai/gpt-5/");
  });

  it("去掉 base 和语言前缀", () => {
    expect(stripLocale("/x/en/models/a/b/", "/x/")).toBe("models/a/b/");
    expect(stripLocale("/x/calculator/", "/x/")).toBe("calculator/");
    expect(stripLocale("/en", "/")).toBe("");
    expect(stripLocale("/en/", "/")).toBe("");
    expect(stripLocale("/other/page", "/x/")).toBe("other/page");
  });

  it("生成绝对 URL", () => {
    expect(absoluteUrl("https://a.github.io/", "/x/rss.xml")).toBe("https://a.github.io/x/rss.xml");
  });
});
